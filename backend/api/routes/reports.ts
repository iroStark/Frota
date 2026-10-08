// Relatórios por período (dias locais de Luanda, inclusive) e exportação CSV.
import type { Router } from "express";
import { z } from "zod";
import { HttpError, parse, route } from "../../lib/http.ts";
import { type Db, isoDate, staff, withClient } from "../context.ts";

const PAID = `coalesce((SELECT sum(a.amount) FROM payment_allocations a JOIN payments p ON p.id = a.payment_id
                        WHERE a.charge_id = c.id AND p.voided_at IS NULL), 0)`;
const LOCAL_DAY = (column: string) => `(${column} AT TIME ZONE 'Africa/Luanda')::date`;

const periodSchema = z.object({ from: isoDate, to: isoDate }).refine((p) => p.from <= p.to, "O início tem de ser antes do fim.");

type Period = z.infer<typeof periodSchema>;

export async function reportSummary(db: Db, { from, to }: Period) {
  const one = async (sql: string, params: unknown[] = [from, to]) => (await db.query(sql, params)).rows;

  const [totals] = await one(
    `SELECT
       (SELECT coalesce(sum(amount), 0) FROM payments WHERE voided_at IS NULL AND ${LOCAL_DAY("received_at")} BETWEEN $1 AND $2) AS received,
       (SELECT coalesce(sum(amount), 0) FROM expenses WHERE deleted_at IS NULL AND responsible = 'proprietaria' AND spent_on BETWEEN $1 AND $2) AS owner_expenses,
       (SELECT coalesce(sum(amount), 0) FROM expenses WHERE deleted_at IS NULL AND responsible = 'motorista' AND spent_on BETWEEN $1 AND $2) AS driver_expenses,
       (SELECT coalesce(sum(amount), 0) FROM charges WHERE kind = 'semanal' AND status <> 'anulada' AND period_start BETWEEN $1 AND $2) AS weekly_charged,
       (SELECT coalesce(sum(amount), 0) FROM charges WHERE kind <> 'semanal' AND status <> 'anulada' AND ${LOCAL_DAY("due_at")} BETWEEN $1 AND $2) AS other_charged`,
  );

  // Uma linha por semana: esperado (cobranças semanais) e quanto já foi pago dessas semanas.
  const weeks = await one(
    `SELECT c.period_start AS week, sum(c.amount) AS expected, sum(least(${PAID}, c.amount)) AS paid,
            count(*) FILTER (WHERE c.amount > 0) AS drivers,
            count(*) FILTER (WHERE c.status IN ('aberta', 'parcial') AND c.due_at < now()) AS overdue
     FROM charges c
     WHERE c.kind = 'semanal' AND c.status <> 'anulada' AND c.period_start BETWEEN $1 AND $2
     GROUP BY c.period_start ORDER BY c.period_start`,
  );

  const drivers = await one(
    `SELECT d.id, d.name,
            coalesce(sum(c.amount) FILTER (WHERE c.kind = 'semanal'), 0) AS weekly_charged,
            coalesce(sum(c.amount) FILTER (WHERE c.kind <> 'semanal'), 0) AS penalties_and_fines,
            coalesce(sum(least(${PAID}, c.amount)), 0) AS paid,
            count(*) FILTER (WHERE c.kind = 'penalidade_atraso') AS late_weeks,
            (SELECT coalesce(sum(p.amount), 0) FROM payments p WHERE p.driver_id = d.id AND p.voided_at IS NULL
               AND ${LOCAL_DAY("p.received_at")} BETWEEN $1 AND $2) AS received_in_period
     FROM drivers d
     JOIN charges c ON c.driver_id = d.id AND c.status <> 'anulada'
       AND coalesce(c.period_start, ${LOCAL_DAY("c.due_at")}) BETWEEN $1 AND $2
     GROUP BY d.id, d.name
     ORDER BY d.name`,
  );

  const vehicles = await one(
    `SELECT v.id, v.plate, v.brand, v.model,
            coalesce(ch.charged, 0) AS charged, coalesce(ch.paid, 0) AS paid,
            coalesce(ex.owner, 0) AS owner_expenses,
            coalesce(ch.paid, 0) - coalesce(ex.owner, 0) AS net
     FROM vehicles v
     LEFT JOIN LATERAL (
       SELECT sum(c.amount) AS charged, sum(least(${PAID}, c.amount)) AS paid FROM charges c
       WHERE c.vehicle_id = v.id AND c.kind = 'semanal' AND c.status <> 'anulada' AND c.period_start BETWEEN $1 AND $2) ch ON true
     LEFT JOIN LATERAL (
       SELECT sum(e.amount) FILTER (WHERE e.responsible = 'proprietaria') AS owner FROM expenses e
       WHERE e.vehicle_id = v.id AND e.deleted_at IS NULL AND e.spent_on BETWEEN $1 AND $2) ex ON true
     WHERE v.deleted_at IS NULL AND (ch.charged IS NOT NULL OR ex.owner IS NOT NULL)
     ORDER BY net DESC`,
  );

  const expensesByCategory = await one(
    `SELECT category, sum(amount) AS total FROM expenses
     WHERE deleted_at IS NULL AND responsible = 'proprietaria' AND spent_on BETWEEN $1 AND $2
     GROUP BY category ORDER BY total DESC`,
  );

  const received = Number(totals.received);
  const ownerExpenses = Number(totals.owner_expenses);
  const weeklyCharged = Number(totals.weekly_charged);
  const weeklyPaid = weeks.reduce((sum, row) => sum + Number(row.paid), 0);
  return {
    period: { from, to },
    totals: {
      received,
      ownerExpenses,
      driverExpenses: Number(totals.driver_expenses),
      net: received - ownerExpenses,
      weeklyCharged,
      weeklyPaid,
      collectionRate: weeklyCharged ? Math.round((weeklyPaid / weeklyCharged) * 100) : 100,
      otherCharged: Number(totals.other_charged),
    },
    weeks: weeks.map((row) => ({ week: row.week, expected: Number(row.expected), paid: Number(row.paid), drivers: Number(row.drivers), overdue: Number(row.overdue) })),
    drivers: drivers.map((row) => ({
      id: row.id, name: row.name, weeklyCharged: Number(row.weekly_charged), penaltiesAndFines: Number(row.penalties_and_fines),
      paid: Number(row.paid), outstanding: Number(row.weekly_charged) + Number(row.penalties_and_fines) - Number(row.paid),
      lateWeeks: Number(row.late_weeks), receivedInPeriod: Number(row.received_in_period),
    })),
    vehicles: vehicles.map((row) => ({
      id: row.id, plate: row.plate, name: `${row.brand} ${row.model}`.trim(), charged: Number(row.charged), paid: Number(row.paid),
      ownerExpenses: Number(row.owner_expenses), net: Number(row.net),
    })),
    expensesByCategory: expensesByCategory.map((row) => ({ category: row.category, total: Number(row.total) })),
  };
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  // Evita fórmulas ao abrir no Excel (=, +, -, @ no início).
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[";\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export async function movementsCsv(db: Db, { from, to }: Period): Promise<string> {
  const rows = (await db.query(
    `SELECT * FROM (
       SELECT ${LOCAL_DAY("p.received_at")} AS data, 'Pagamento' AS tipo, d.name AS motorista, NULL AS viatura,
              p.method AS detalhe, p.amount AS valor, p.reference AS referencia
       FROM payments p JOIN drivers d ON d.id = p.driver_id
       WHERE p.voided_at IS NULL AND ${LOCAL_DAY("p.received_at")} BETWEEN $1 AND $2
       UNION ALL
       SELECT e.spent_on, 'Despesa (' || e.responsible || ')', NULL, v.plate, e.category, e.amount, e.supplier
       FROM expenses e LEFT JOIN vehicles v ON v.id = e.vehicle_id
       WHERE e.deleted_at IS NULL AND e.spent_on BETWEEN $1 AND $2
       UNION ALL
       SELECT coalesce(c.period_start, ${LOCAL_DAY("c.due_at")}), 'Cobrança ' || c.kind, d.name, v.plate, c.status, c.amount, NULL
       FROM charges c JOIN drivers d ON d.id = c.driver_id LEFT JOIN vehicles v ON v.id = c.vehicle_id
       WHERE c.status <> 'anulada' AND coalesce(c.period_start, ${LOCAL_DAY("c.due_at")}) BETWEEN $1 AND $2
     ) m ORDER BY data, tipo`,
    [from, to],
  )).rows;
  const header = ["data", "tipo", "motorista", "viatura", "detalhe", "valor_kz", "referencia"];
  const lines = rows.map((row) => [row.data, row.tipo, row.motorista, row.viatura, row.detalhe, row.valor, row.referencia].map(csvCell).join(";"));
  // BOM + ";" para o Excel em português abrir com acentos e colunas certas.
  return `﻿${header.join(";")}\n${lines.join("\n")}\n`;
}

export function registerReportRoutes(router: Router) {
  router.get("/reports/summary", staff, route(async (request, response) => {
    const period = parse(periodSchema, request.query);
    if (Date.parse(period.to) - Date.parse(period.from) > 400 * 86_400_000) {
      throw new HttpError(422, "periodo_longo", "Escolha um período até 13 meses.");
    }
    response.json(await withClient((db) => reportSummary(db, period)));
  }));

  router.get("/reports/movements.csv", staff, route(async (request, response) => {
    const period = parse(periodSchema, request.query);
    const csv = await withClient((db) => movementsCsv(db, period));
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", `attachment; filename="uhocha-movimentos-${period.from}-a-${period.to}.csv"`);
    response.send(csv);
  }));
}
