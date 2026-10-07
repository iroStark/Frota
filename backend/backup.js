import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, pool } from "./db.js";

// Exporta o estado da app e os metadados dos uploads para backups/. Os ficheiros em si
// (UPLOADS_DIR / Volume do Railway) não são incluídos e devem ser copiados à parte.
const __dirname = dirname(fileURLToPath(import.meta.url));
const backupsDir = resolve(process.env.BACKUPS_DIR || join(__dirname, "..", "backups"));

try {
  const [state, uploads] = await Promise.all([
    pool.query("SELECT * FROM app_state"),
    pool.query("SELECT * FROM uploads ORDER BY uploaded_at"),
  ]);
  await mkdir(backupsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = join(backupsDir, `uhocha-backup-${stamp}.json`);
  await writeFile(target, JSON.stringify({
    exportedAt: new Date().toISOString(),
    appState: state.rows,
    uploads: uploads.rows,
  }, null, 2));
  console.log(`Cópia criada: ${target} (${state.rowCount} estado(s), ${uploads.rowCount} upload(s)).`);
} finally {
  await closePool();
}
