import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));

export const connectionString = process.env.DATABASE_URL || "postgresql://localhost:5432/uhocha_controle";

const sslEnv = String(process.env.PGSSL || "").toLowerCase();
const needsSsl =
  sslEnv === "true" || sslEnv === "1" || sslEnv === "require" ||
  /[?&]sslmode=require/i.test(connectionString) ||
  /\.proxy\.rlwy\.net/i.test(connectionString);

export const pool = new Pool({
  connectionString,
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
  ssl: needsSsl ? { rejectUnauthorized: false } : false,
});

const migrationsDir = join(__dirname, "migrations");
const MIGRATION_LOCK_ID = 727274; // pg_advisory_lock: impede duas instâncias de migrar em simultâneo

// Aplica por ordem os ficheiros NNN_nome.sql ainda não registados em schema_migrations,
// cada um na sua transação.
export async function migrate({ log = console.log } = {}) {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const applied = new Set((await client.query("SELECT name FROM schema_migrations")).rows.map((row) => row.name));
    const files = (await readdir(migrationsDir)).filter((name) => /^\d{3}_.+\.sql$/.test(name)).sort();
    for (const name of files) {
      if (applied.has(name)) continue;
      const sql = await readFile(join(migrationsDir, name), "utf8");
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
        await client.query("COMMIT");
        log(`Migração aplicada: ${name}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Falha na migração ${name}: ${error.message}`, { cause: error });
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]).catch(() => {});
    client.release();
  }
}

export async function closePool() {
  await pool.end();
}
