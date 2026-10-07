import "dotenv/config";
import cors from "cors";
import express from "express";
import multer from "multer";
import { mkdir, open, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { authMode, registerAuthRoutes, requireAuth } from "./auth.js";
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
const allowedUploads = new Map([
  ["application/pdf", ".pdf"],
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/heic", ".heic"],
  ["image/heif", ".heif"],
]);
const AUDIT_MIN_INTERVAL = "5 minutes";
const AUDIT_RETENTION = "90 days";
const corsOrigins = String(process.env.CORS_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

await mkdir(uploadsDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_request, _file, callback) => callback(null, uploadsDir),
    filename: (request, file, callback) => {
      const uploadId = randomUUID();
      request.uploadId = uploadId;
      callback(null, `${uploadId}${allowedUploads.get(file.mimetype)}`);
    },
  }),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    if (allowedUploads.has(file.mimetype)) {
      callback(null, true);
      return;
    }
    const error = new Error("Formato de documento não permitido.");
    error.status = 415;
    callback(error);
  },
});

// O frontend é servido pelo mesmo servidor; CORS só para origens explicitamente configuradas.
if (corsOrigins.length) {
  app.use(cors({ origin: corsOrigins, credentials: true }));
}
app.use(express.json({ limit: "10mb" }));
registerAuthRoutes(app);
app.use("/api/state", requireAuth);
app.use("/api/uploads", requireAuth);
app.use("/uploads", requireAuth);

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
      "SELECT payload, updated_at, revision FROM app_state WHERE id = $1",
      [stateId],
    );

    if (!result.rowCount) {
      response.status(404).json({ state: null, updatedAt: null, revision: 0 });
      return;
    }

    response.json({
      state: result.rows[0].payload,
      updatedAt: result.rows[0].updated_at,
      revision: Number(result.rows[0].revision),
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

    if (!(await hasExpectedSignature(request.file.path, request.file.mimetype))) {
      await unlink(request.file.path).catch(() => {});
      response.status(415).json({ error: "O conteúdo do ficheiro não corresponde ao formato indicado." });
      return;
    }

    const id = request.uploadId;
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

// Controlo de concorrência otimista: o cliente envia a revisão em que se baseou; se outro aparelho
// gravou entretanto, devolve 409 em vez de sobrescrever.
async function saveState(request, response, next) {
  const client = await pool.connect();
  try {
    const payload = request.body?.state;
    const baseRevision = Number(request.body?.baseRevision);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      response.status(400).json({ error: "Payload de estado inválido." });
      return;
    }
    if (!Number.isInteger(baseRevision) || baseRevision < 0) {
      response.status(400).json({ error: "baseRevision em falta." });
      return;
    }

    await client.query("BEGIN");
    const current = await client.query(
      "SELECT revision FROM app_state WHERE id = $1 FOR UPDATE",
      [stateId],
    );
    const currentRevision = current.rowCount ? Number(current.rows[0].revision) : 0;
    if (currentRevision !== baseRevision) {
      await client.query("ROLLBACK");
      response.status(409).json({ error: "Os dados foram alterados noutro aparelho.", revision: currentRevision });
      return;
    }

    const result = await client.query(
      `INSERT INTO app_state (id, payload, version, revision)
       VALUES ($1, $2::jsonb, $3, 1)
       ON CONFLICT (id)
       DO UPDATE SET payload = EXCLUDED.payload, version = EXCLUDED.version, revision = app_state.revision + 1
       RETURNING updated_at, revision`,
      [stateId, JSON.stringify(payload), Number(payload.version || 1)],
    );

    await client.query(
      `INSERT INTO app_state_audit (state_id, payload, source)
       SELECT $1, $2::jsonb, $3
       WHERE NOT EXISTS (
         SELECT 1 FROM app_state_audit
         WHERE state_id = $1 AND saved_at > now() - $4::interval
       )`,
      [stateId, JSON.stringify(payload), request.get("origin") || "api", AUDIT_MIN_INTERVAL],
    );
    await client.query(
      "DELETE FROM app_state_audit WHERE state_id = $1 AND saved_at < now() - $2::interval",
      [stateId, AUDIT_RETENTION],
    );
    await client.query("COMMIT");

    response.json({
      ok: true,
      updatedAt: result.rows[0].updated_at,
      revision: Number(result.rows[0].revision),
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    next(error);
  } finally {
    client.release();
  }
}

// Confirma pelos primeiros bytes que o ficheiro é mesmo do tipo declarado pelo browser.
async function hasExpectedSignature(path, mimeType) {
  const handle = await open(path, "r");
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(12), 0, 12, 0);
    if (bytesRead < 4) return false;
    const ascii = (start, end) => buffer.subarray(start, end).toString("latin1");
    switch (mimeType) {
      case "application/pdf":
        return ascii(0, 4) === "%PDF";
      case "image/jpeg":
        return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
      case "image/png":
        return buffer.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      case "image/webp":
        return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
      case "image/heic":
      case "image/heif":
        return ascii(4, 8) === "ftyp";
      default:
        return false;
    }
  } finally {
    await handle.close();
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
  if (error.status && error.status < 500) {
    response.status(error.status).json({ error: error.message });
    return;
  }
  response.status(500).json({ error: "Erro interno do servidor." });
});

await runMigrationsWithRetry();

app.listen(port, "0.0.0.0", () => {
  console.log(`UHOCHA backend ready on port ${port}`);
  if (authMode === "open") {
    console.warn("APP_ACCESS_KEY não definida: API aberta (apenas aceitável em desenvolvimento).");
  }
  if (authMode === "misconfigured") {
    console.error("APP_ACCESS_KEY não definida em produção: a API vai recusar todos os pedidos até ser configurada.");
  }
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
