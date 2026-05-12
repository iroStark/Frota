import "dotenv/config";
import cors from "cors";
import express from "express";
import multer from "multer";
import { mkdir } from "node:fs/promises";
import { extname } from "node:path";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate, pool } from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const app = express();
const port = Number(process.env.PORT || 3000);
const stateId = process.env.APP_STATE_ID || "main";
const uploadsDir = process.env.UPLOADS_DIR
  ? resolve(process.env.UPLOADS_DIR)
  : join(rootDir, "uploads");

app.set("trust proxy", true);
const allowedUploads = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

await mkdir(uploadsDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_request, _file, callback) => callback(null, uploadsDir),
    filename: (request, file, callback) => {
      const uploadId = randomUUID();
      request.uploadId = uploadId;
      callback(null, `${uploadId}${extname(file.originalname).toLowerCase()}`);
    },
  }),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    if (allowedUploads.has(file.mimetype)) {
      callback(null, true);
      return;
    }
    callback(new Error("Formato de documento não permitido."));
  },
});

app.use(cors({ origin: true }));
app.use(express.json({ limit: "10mb" }));

app.get("/api/health", async (_request, response, next) => {
  try {
    const result = await pool.query("SELECT now() AS db_time");
    response.json({ ok: true, database: "connected", dbTime: result.rows[0].db_time });
  } catch (error) {
    next(error);
  }
});

app.get("/api/state", async (_request, response, next) => {
  try {
    const result = await pool.query(
      "SELECT payload, updated_at FROM app_state WHERE id = $1",
      [stateId],
    );

    if (!result.rowCount) {
      response.status(404).json({ state: null, updatedAt: null });
      return;
    }

    response.json({
      state: result.rows[0].payload,
      updatedAt: result.rows[0].updated_at,
    });
  } catch (error) {
    next(error);
  }
});

app.put("/api/state", saveState);
app.post("/api/state", saveState);

app.post("/api/uploads", upload.single("file"), async (request, response, next) => {
  try {
    if (!request.file) {
      response.status(400).json({ error: "Nenhum ficheiro enviado." });
      return;
    }

    const id = request.uploadId || request.file.filename.replace(extname(request.file.filename), "");
    const category = String(request.body?.category || "documento").slice(0, 80);
    const url = `/uploads/${request.file.filename}`;

    const result = await pool.query(
      `INSERT INTO uploads (id, original_name, stored_name, mime_type, size_bytes, category, url)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING uploaded_at`,
      [
        id,
        request.file.originalname,
        request.file.filename,
        request.file.mimetype,
        request.file.size,
        category,
        url,
      ],
    );

    response.status(201).json({
      id,
      originalName: request.file.originalname,
      storedName: request.file.filename,
      mimeType: request.file.mimetype,
      size: request.file.size,
      category,
      url,
      uploadedAt: result.rows[0].uploaded_at,
    });
  } catch (error) {
    next(error);
  }
});

async function saveState(request, response, next) {
  try {
    const payload = request.body?.state ?? request.body;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      response.status(400).json({ error: "Payload de estado inválido." });
      return;
    }

    const result = await pool.query(
      `INSERT INTO app_state (id, payload, version)
       VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (id)
       DO UPDATE SET payload = EXCLUDED.payload, version = EXCLUDED.version
       RETURNING updated_at`,
      [stateId, JSON.stringify(payload), Number(payload.version || 1)],
    );

    await pool.query(
      "INSERT INTO app_state_audit (state_id, payload, source) VALUES ($1, $2::jsonb, $3)",
      [stateId, JSON.stringify(payload), request.get("origin") || "api"],
    );

    response.json({ ok: true, updatedAt: result.rows[0].updated_at });
  } catch (error) {
    next(error);
  }
}

const staticFiles = ["app.js", "styles.css", "manifest.webmanifest", "sw.js"];
staticFiles.forEach((fileName) => {
  app.get(`/${fileName}`, (_request, response) => {
    response.sendFile(join(rootDir, fileName));
  });
});

app.use("/assets", express.static(join(rootDir, "assets")));
app.use("/icons", express.static(join(rootDir, "icons")));
app.use("/uploads", express.static(uploadsDir));

app.get(["/", "/index.html"], (_request, response) => {
  response.sendFile(join(rootDir, "index.html"));
});

app.get(/^\/(?!api).*/, (_request, response) => {
  response.sendFile(join(rootDir, "index.html"));
});

app.use((error, _request, response, _next) => {
  console.error(error);
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    response.status(413).json({ error: "O ficheiro é maior que 12 MB." });
    return;
  }
  response.status(500).json({ error: "Erro interno do servidor." });
});

await runMigrationsWithRetry();

app.listen(port, "0.0.0.0", () => {
  console.log(`UHOCHA backend ready on port ${port}`);
});

async function runMigrationsWithRetry(attempts = 10, delayMs = 2000) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await migrate();
      return;
    } catch (error) {
      console.warn(`Migração falhou (tentativa ${attempt}/${attempts}): ${error.message}`);
      if (attempt === attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
