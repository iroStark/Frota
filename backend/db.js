import "dotenv/config";
import { readFile } from "node:fs/promises";
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

export async function migrate() {
  const schema = await readFile(join(__dirname, "schema.sql"), "utf8");
  await pool.query(schema);
}

export async function closePool() {
  await pool.end();
}
