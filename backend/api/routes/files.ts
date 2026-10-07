// Ficheiros da API v1: envio por qualquer utilizador autenticado; download só para quem tem direito.
import { randomUUID } from "node:crypto";
import { mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { NextFunction, Request, Response, Router } from "express";
import multer from "multer";
import { z } from "zod";
import { pool } from "../../db.js";
import { MAX_UPLOAD_BYTES, allowedUploads, hasExpectedSignature, uploadsDir } from "../../lib/files.ts";
import { HttpError, parse, route } from "../../lib/http.ts";
import type { AccessClaims } from "../../lib/security.ts";
import { notFound, uuid } from "../context.ts";

const upload = multer({
  storage: multer.diskStorage({
    destination: (_request, _file, callback) => {
      mkdir(uploadsDir, { recursive: true }).then(() => callback(null, uploadsDir), (error) => callback(error, uploadsDir));
    },
    filename: (_request, file, callback) => callback(null, `${randomUUID()}${allowedUploads.get(file.mimetype)}`),
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (allowedUploads.has(file.mimetype)) callback(null, true);
    else callback(new HttpError(415, "formato", "Formato não permitido (PDF, JPG, PNG, WEBP ou HEIC)."));
  },
});

function handleUpload(request: Request, response: Response, next: NextFunction) {
  upload.single("file")(request, response, (error: unknown) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      next(new HttpError(413, "tamanho", "O ficheiro é maior que 12 MB."));
      return;
    }
    next(error);
  });
}

/** Um motorista só abre ficheiros que enviou ou que estão ligados a ele. */
async function canDriverRead(user: AccessClaims, fileId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM files WHERE id = $1 AND uploaded_by = $2)
         OR EXISTS (SELECT 1 FROM documents WHERE file_id = $1 AND owner_type = 'driver' AND owner_id = $3 AND deleted_at IS NULL)
         OR EXISTS (SELECT 1 FROM documents d JOIN assignments a ON a.vehicle_id = d.owner_id AND a.status = 'ativa'
                    WHERE d.file_id = $1 AND d.owner_type = 'vehicle' AND a.driver_id = $3 AND d.deleted_at IS NULL)
         OR EXISTS (SELECT 1 FROM payments WHERE proof_file_id = $1 AND driver_id = $3)
         OR EXISTS (SELECT 1 FROM payment_declarations WHERE proof_file_id = $1 AND driver_id = $3)
         OR EXISTS (SELECT 1 FROM incident_attachments ia JOIN incidents i ON i.id = ia.incident_id
                    WHERE ia.file_id = $1 AND i.driver_id = $3) AS allowed`,
    [fileId, user.sub, user.driverId],
  );
  return result.rows[0].allowed;
}

export function registerFileRoutes(router: Router) {
  router.post("/files", handleUpload, route(async (request, response) => {
    const file = request.file;
    if (!file) throw new HttpError(400, "sem_ficheiro", "Nenhum ficheiro enviado (campo \"file\").");
    if (!(await hasExpectedSignature(file.path, file.mimetype))) {
      await unlink(file.path).catch(() => {});
      throw new HttpError(415, "conteudo", "O conteúdo do ficheiro não corresponde ao formato indicado.");
    }
    const category = parse(z.string().trim().max(60).optional(), request.body?.category) ?? "documento";
    const result = await pool.query(
      `INSERT INTO files (original_name, storage_key, mime_type, size_bytes, category, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, original_name, mime_type, size_bytes, category, created_at`,
      [file.originalname.slice(0, 200), file.filename, file.mimetype, file.size, category, request.user.sub],
    );
    response.status(201).json(result.rows[0]);
  }));

  router.get("/files/:id", route(async (request, response) => {
    const id = parse(uuid, request.params.id);
    const result = await pool.query("SELECT storage_key, mime_type, original_name FROM files WHERE id = $1", [id]);
    if (!result.rowCount) throw notFound("Ficheiro");
    if (request.user.role === "motorista" && !(await canDriverRead(request.user, id))) {
      throw new HttpError(403, "sem_permissao", "Sem permissão para este ficheiro.");
    }
    const file = result.rows[0];
    response.setHeader("Content-Type", file.mime_type);
    response.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(file.original_name)}"`);
    response.setHeader("Cache-Control", "private, max-age=3600");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.sendFile(join(uploadsDir, file.storage_key), (error) => {
      if (error && !response.headersSent) response.status(404).json({ error: "Ficheiro em falta no armazenamento." });
    });
  }));
}
