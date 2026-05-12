import "dotenv/config";
import pg from "pg";

const { Client } = pg;
const target = new URL(process.env.DATABASE_URL || "postgresql://localhost:5432/uhocha_controle");
const databaseName = decodeURIComponent(target.pathname.replace(/^\//, "")) || "uhocha_controle";
const admin = new URL(target);
admin.pathname = "/postgres";

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

const client = new Client({ connectionString: admin.toString() });

try {
  await client.connect();
  const result = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);

  if (result.rowCount) {
    console.log(`Database "${databaseName}" already exists.`);
  } else {
    await client.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
    console.log(`Database "${databaseName}" created.`);
  }
} finally {
  await client.end();
}
