// Painel do gestor, alertas e ecrã inicial do motorista — tudo calculado no servidor.
import type { Router } from "express";
import type pg from "pg";
import { pool } from "../../db.js";
import { calculateWeeklyCharge, weeklyDueAt } from "../../domain/charges.ts";
import { addDays, localDateOf, weekStartOf } from "../../domain/time.ts";
import { route } from "../../lib/http.ts";
import { driverStatement, rulesAt } from "../../services/billing.ts";
import { type Db, driverOnly, staff, withClient } from "../context.ts";
import { DOCUMENT_SELECT } from "./fleet.ts";

const LUANDA_OFFSET = 60;
const DOCUMENT_LABELS: Record<string, string> = {
  bilhete_identidade: "Bilhete de Identidade", carta_conducao: "Carta de condução", livrete: "Livrete",
  titulo_propriedade: "Título de propriedade", seguro: "Seguro", inspecao: "Inspeção",
  imposto_circulacao: "Imposto de circulação", licenca_taxi: "Licença de táxi", contrato: "Contrato", outro: "Documento",
};
const PAID = `coalesce((SELECT sum(a.amount) FROM payment_allocations a JOIN payments p ON p.id = a.payment_id
                        WHERE a.charge_id = c.id AND p.voided_at IS NULL), 0)`;

/**
 * Executa consultas uma a uma: um cliente pg só corre uma consulta de cada vez
 * (Promise.all sobre o mesmo cliente está obsoleto no pg 9).
 */
async function sequential(queries: (() => Promise<pg.QueryResult>)[]): Promise<pg.QueryResult[]> {
  const results: pg.QueryResult[] = [];
  for (const query of queries) results.push(await query());
  return results;
}

const kzFormat = new Intl.NumberFormat("pt-PT", { maximumFractionDigits: 0, useGrouping: "always" });
const MONTHS = ["jan.", "fev.", "mar.", "abr.", "mai.", "jun.", "jul.", "ago.", "set.", "out.", "nov.", "dez."];
/** Textos dos alertas prontos a mostrar: "86 667 Kz", "14 set.", "16 dias". */
const kz = (value: unknown) => `${kzFormat.format(Number(value)).replace(/\s/g, "\u00A0")}\u00A0Kz`;
const day = (value: unknown) => {
  const [, month, dayOfMonth] = String(value ?? "").slice(0, 10).split("-").map(Number);
  return month ? `${dayOfMonth} ${MONTHS[month - 1]}` : "";
};
const delay = (hours: unknown) => {
  const total = Number(hours);
  return total >= 48 ? `${Math.floor(total / 24)} dias` : `${total} h`;
};

type Alert = { severity: "danger" | "warn" | "info"; kind: string; title: string; detail: string; target?: { type: string; id: string } };

async function staffDashboard(db: Db, now: Date) {
  const today = localDateOf(now.getTime(), LUANDA_OFFSET);
  const billingWeek = addDays(weekStartOf(today), -7);
  const month = today.slice(0, 7);

  const [week, debt, breaches, review, documents, vehicles, monthTotals] = await sequential([
    () => db.query(
      `SELECT c.id, c.driver_id, d.name AS driver_name, c.amount, c.status, c.due_at, ${PAID} AS paid
       FROM charges c JOIN drivers d ON d.id = c.driver_id
       WHERE c.kind = 'semanal' AND c.period_start = $1 AND c.status <> 'anulada' ORDER BY d.name`,
      [billingWeek],
    ),
    () => db.query(
      `SELECT coalesce(sum(c.amount - ${PAID}), 0) AS total, count(DISTINCT c.driver_id) AS drivers
       FROM charges c WHERE c.status IN ('aberta', 'parcial') AND c.due_at < $1`,
      [now],
    ),
    () => db.query(
      `SELECT c.id, c.driver_id, d.name AS driver_name, c.period_start, c.amount - ${PAID} AS outstanding,
              floor(extract(epoch FROM ($1 - c.due_at)) / 3600) AS delay_hours
       FROM charges c JOIN drivers d ON d.id = c.driver_id
       WHERE c.kind = 'semanal' AND c.status IN ('aberta', 'parcial') AND c.due_at < $1 - interval '72 hours'
       ORDER BY c.due_at`,
      [now],
    ),
    () => db.query(
      `SELECT (SELECT count(*) FROM payment_declarations WHERE status = 'pendente') AS declarations,
              (SELECT count(*) FROM incidents WHERE status = 'por_validar') AS incidents`,
    ),
    () => db.query(
      `SELECT x.*, coalesce(v.plate, dr.name) AS owner_name FROM (${DOCUMENT_SELECT}) x
       LEFT JOIN vehicles v ON x.owner_type = 'vehicle' AND v.id = x.owner_id
       LEFT JOIN drivers dr ON x.owner_type = 'driver' AND dr.id = x.owner_id
       WHERE x.deleted_at IS NULL AND x.validity IN ('expirado', 'a_expirar')
       ORDER BY x.valid_until`,
    ),
    () => db.query("SELECT status, count(*)::int AS n FROM vehicles WHERE deleted_at IS NULL GROUP BY status"),
    () => db.query(
      `SELECT
         (SELECT coalesce(sum(amount), 0) FROM payments WHERE voided_at IS NULL
            AND to_char(received_at AT TIME ZONE 'Africa/Luanda', 'YYYY-MM') = $1) AS received,
         (SELECT coalesce(sum(amount), 0) FROM expenses WHERE deleted_at IS NULL AND responsible = 'proprietaria'
            AND to_char(spent_on, 'YYYY-MM') = $1) AS owner_expenses`,
      [month],
    ),
  ]);

  const weekRows = week.rows.map((row) => ({ ...row, outstanding: Number(row.amount) - Number(row.paid) }));
  const expected = weekRows.reduce((sum, row) => sum + Number(row.amount), 0);
  const paid = weekRows.reduce((sum, row) => sum + Math.min(Number(row.paid), Number(row.amount)), 0);
  const { rules } = await rulesAt(db, billingWeek);
  const received = Number(monthTotals.rows[0].received);
  const ownerExpenses = Number(monthTotals.rows[0].owner_expenses);

  const alerts: Alert[] = [
    ...breaches.rows.map((row): Alert => ({
      severity: "danger", kind: "atraso_72h",
      title: `${row.driver_name}: atraso superior a 72h`,
      detail: `Semana de ${day(row.period_start)}: faltam ${kz(row.outstanding)} há ${delay(row.delay_hours)}. O contrato prevê possível resolução.`,
      target: { type: "driver", id: row.driver_id },
    })),
    ...weekRows.filter((row) => row.outstanding > 0 && row.status !== "isenta").map((row): Alert => ({
      severity: new Date(row.due_at).getTime() < now.getTime() ? "danger" : "warn", kind: "entrega_pendente",
      title: `Entrega pendente: ${row.driver_name}`,
      detail: `Faltam ${kz(row.outstanding)} da semana de ${day(billingWeek)}.`,
      target: { type: "driver", id: row.driver_id },
    })),
    ...documents.rows.map((row): Alert => ({
      severity: row.validity === "expirado" ? "danger" : "warn", kind: "documento",
      title: `${DOCUMENT_LABELS[row.type] ?? row.type}: ${row.owner_name ?? "empresa"}`,
      detail: row.validity === "expirado" ? `Expirou a ${day(row.valid_until)}.` : `Expira a ${day(row.valid_until)}.`,
      target: row.owner_id ? { type: row.owner_type, id: row.owner_id } : undefined,
    })),
    ...(Number(review.rows[0].declarations) ? [{
      severity: "info" as const, kind: "comprovativos", title: "Comprovativos por confirmar",
      detail: `${review.rows[0].declarations} enviado(s) por motoristas.`,
    }] : []),
    ...(Number(review.rows[0].incidents) ? [{
      severity: "info" as const, kind: "ocorrencias", title: "Ocorrências por validar",
      detail: `${review.rows[0].incidents} comunicada(s) por motoristas.`,
    }] : []),
  ];
  const rank = { danger: 0, warn: 1, info: 2 };
  alerts.sort((a, b) => rank[a.severity] - rank[b.severity]);

  return {
    generatedAt: now.toISOString(),
    billingWeek: {
      periodStart: billingWeek,
      periodEnd: addDays(billingWeek, 6),
      dueAt: weeklyDueAt(billingWeek, rules),
      expected,
      paid,
      outstanding: expected - paid,
      progress: expected ? Math.round((paid / expected) * 100) : 100,
      charges: weekRows,
    },
    debt: { total: Number(debt.rows[0].total), drivers: Number(debt.rows[0].drivers) },
    toReview: { declarations: Number(review.rows[0].declarations), incidents: Number(review.rows[0].incidents) },
    vehicles: Object.fromEntries(vehicles.rows.map((row) => [row.status, row.n])),
    month: { month, received, ownerExpenses, net: received - ownerExpenses },
    alerts,
  };
}

async function driverHome(db: Db, driverId: string, now: Date) {
  const today = localDateOf(now.getTime(), LUANDA_OFFSET);
  const currentWeek = weekStartOf(today);
  const [totals, assignment, documents, declarations, incidents] = await sequential([
    () => db.query(
      `SELECT coalesce(sum(c.amount), 0) AS charged,
              coalesce(sum(c.amount - ${PAID}) FILTER (WHERE c.status IN ('aberta', 'parcial') AND c.due_at < $2), 0) AS overdue,
              (SELECT coalesce(sum(amount), 0) FROM payments WHERE driver_id = $1 AND voided_at IS NULL) AS paid
       FROM charges c WHERE c.driver_id = $1 AND c.status <> 'anulada'`,
      [driverId, now],
    ),
    () => db.query(
      `SELECT a.id, a.start_at, a.end_at, a.weekly_fee, a.vehicle_id, v.brand, v.model, v.plate, v.status AS vehicle_status
       FROM assignments a JOIN vehicles v ON v.id = a.vehicle_id WHERE a.driver_id = $1 AND a.status = 'ativa'`,
      [driverId],
    ),
    () => db.query(`${DOCUMENT_SELECT} WHERE d.owner_type = 'driver' AND d.owner_id = $1 AND d.deleted_at IS NULL ORDER BY d.valid_until NULLS LAST`, [driverId]),
    () => db.query("SELECT id, amount, paid_at, status, rejection_reason, submitted_at FROM payment_declarations WHERE driver_id = $1 ORDER BY submitted_at DESC LIMIT 5", [driverId]),
    () => db.query("SELECT id, type, status, start_at, end_at FROM incidents WHERE driver_id = $1 AND status IN ('por_validar', 'agendada', 'em_curso') ORDER BY start_at DESC", [driverId]),
  ]);

  // Estimativa da semana em curso (vence na segunda seguinte), com as paragens já validadas.
  let nextDue = null;
  const active = assignment.rows[0];
  if (active) {
    const { rules } = await rulesAt(db, currentWeek);
    const stops = await db.query(
      `SELECT id, start_at, end_at FROM incidents WHERE exempts_fee AND validated_at IS NOT NULL
       AND status IN ('agendada', 'em_curso', 'resolvida') AND (vehicle_id = $1 OR driver_id = $2)`,
      [active.vehicle_id, driverId],
    );
    const calc = calculateWeeklyCharge(currentWeek, {
      startAt: active.start_at.toISOString(), endAt: null, weeklyFee: Number(active.weekly_fee),
    }, stops.rows.map((row) => ({ id: row.id, startAt: row.start_at.toISOString(), endAt: row.end_at?.toISOString() ?? null })), rules);
    nextDue = { periodStart: currentWeek, dueAt: calc.dueAt, estimatedAmount: calc.amount, chargedDays: calc.chargedDays, stoppedDays: calc.stoppedDays };
  }
  const charged = Number(totals.rows[0].charged);
  const paid = Number(totals.rows[0].paid);
  return {
    balance: charged - paid,
    overdue: Number(totals.rows[0].overdue),
    nextDue,
    vehicle: active ? { id: active.vehicle_id, brand: active.brand, model: active.model, plate: active.plate, status: active.vehicle_status, since: active.start_at } : null,
    documents: documents.rows,
    declarations: declarations.rows,
    openIncidents: incidents.rows,
  };
}

export function registerDashboardRoutes(router: Router) {
  router.get("/dashboard", staff, route(async (_request, response) => {
    response.json(await withClient((db) => staffDashboard(db, new Date())));
  }));

  router.get("/alerts", staff, route(async (_request, response) => {
    const dashboard = await withClient((db) => staffDashboard(db, new Date()));
    response.json(dashboard.alerts);
  }));

  router.get("/me/home", driverOnly, route(async (request, response) => {
    response.json(await withClient((db) => driverHome(db, request.user.driverId!, new Date())));
  }));

  router.get("/me/statement", driverOnly, route(async (request, response) => {
    response.json(await withClient((db) => driverStatement(db, request.user.driverId!)));
  }));

  router.get("/me/incidents", driverOnly, route(async (request, response) => {
    const result = await pool.query("SELECT * FROM incidents WHERE driver_id = $1 ORDER BY start_at DESC LIMIT 100", [request.user.driverId]);
    response.json(result.rows);
  }));
}
