// Importa o estado JSON do PWA para as tabelas normalizadas.
//   npm run import:legacy -- --dry-run   → só gera o relatório (backups/import-report-*.md/json)
//   npm run import:legacy                → grava tudo numa transação (recusa se já tiver sido importado)
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { closePool, migrate, pool } from "../db.js";
import { type ImportPlan, type ImportReport, planLegacyImport } from "./legacy.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const reportsDir = resolve(process.env.BACKUPS_DIR || join(__dirname, "..", "..", "backups"));
const stateId = process.env.APP_STATE_ID || "main";
const dryRun = process.argv.includes("--dry-run");

// Ordem de inserção respeitando as chaves estrangeiras.
const TABLE_ORDER: (keyof ImportPlan["rows"])[] = [
  "files", "drivers", "driver_contacts", "vehicles", "documents", "assignments", "incidents",
  "expense_batches", "expenses", "charges", "payments", "payment_allocations",
];

function toDbValue(value: unknown): unknown {
  if (value !== null && typeof value === "object" && !(value instanceof Date)) return JSON.stringify(value);
  return value ?? null;
}

async function insertRows(client: pg.PoolClient, table: string, rows: Record<string, unknown>[]) {
  for (const row of rows) {
    const columns = Object.keys(row).filter((key) => row[key] !== undefined);
    const placeholders = columns.map((_, index) => `$${index + 1}`);
    const conflict = table === "files" ? " ON CONFLICT DO NOTHING" : "";
    await client.query(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders.join(", ")})${conflict}`,
      columns.map((key) => toDbValue(row[key])),
    );
  }
}

function formatKz(value: number): string {
  return `${new Intl.NumberFormat("pt-PT").format(value)} Kz`;
}

function reportMarkdown(report: ImportReport, mode: string): string {
  const lines = [
    `# Relatório de importação (${mode})`,
    "",
    `Gerado em ${report.generatedAt}.`,
    "",
    "## Registos",
    "",
    ...Object.entries(report.counts).map(([table, count]) => `- ${table}: ${count}`),
    "",
    "## Motoristas",
    "",
    "| Motorista | Semanas | Cobrado | Pago | Saldo | Semanas em aberto | Penalidades não cobradas |",
    "|---|---:|---:|---:|---:|---|---:|",
    ...report.drivers.map((d) => `| ${d.name} | ${d.weeksCharged} | ${formatKz(d.totalCharged)} | ${formatKz(d.totalPaid)} | ${formatKz(d.balance)} | ${d.openWeeks.join(", ") || "—"} | ${formatKz(d.uncollectedPenalties)} |`),
    "",
    "Saldo positivo = dívida do motorista; negativo = crédito. As penalidades não cobradas **não** foram lançadas: decidir caso a caso.",
    "",
    `## Avisos (${report.warnings.length})`,
    "",
    ...(report.warnings.length ? report.warnings.map((w) => `- ${w}`) : ["Nenhum."]),
    "",
  ];
  return lines.join("\n");
}

async function main() {
  await migrate();
  const state = await pool.query("SELECT payload FROM app_state WHERE id = $1", [stateId]);
  if (!state.rowCount) throw new Error(`Não existe app_state com id "${stateId}".`);

  const plan = planLegacyImport(state.rows[0].payload);
  const stamp = plan.report.generatedAt.replace(/[:.]/g, "-");
  await mkdir(reportsDir, { recursive: true });
  const base = join(reportsDir, `import-report-${stamp}`);
  await writeFile(`${base}.json`, JSON.stringify(plan.report, null, 2));
  await writeFile(`${base}.md`, reportMarkdown(plan.report, dryRun ? "simulação" : "gravado"));

  if (!dryRun) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query(
        "SELECT (SELECT count(*) FROM drivers WHERE legacy_id IS NOT NULL) + (SELECT count(*) FROM vehicles WHERE legacy_id IS NOT NULL) AS n",
      );
      if (Number(existing.rows[0].n) > 0) {
        throw new Error("Os dados antigos já foram importados (existem registos com legacy_id). Nada foi alterado.");
      }
      for (const table of TABLE_ORDER) {
        const rows = table === "charges"
          ? [...plan.rows.charges].sort((a, b) => Number(Boolean(a.related_charge_id)) - Number(Boolean(b.related_charge_id)))
          : plan.rows[table];
        await insertRows(client, table, rows);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  console.log(`${dryRun ? "Simulação concluída" : "Importação concluída"}. Relatório: ${base}.md`);
  console.log(Object.entries(plan.report.counts).map(([table, count]) => `${table}=${count}`).join(" "));
  if (plan.report.warnings.length) console.log(`${plan.report.warnings.length} aviso(s) — ver relatório.`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await closePool();
}
