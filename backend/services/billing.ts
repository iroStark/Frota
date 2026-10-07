// Aplica o motor de cobranças (domain/charges.ts) aos dados da base.
// Todas as funções recebem um cliente já dentro de uma transação.
import type pg from "pg";
import {
  type ContractRules,
  DEFAULT_RULES,
  type StopPeriod,
  allocatePayment,
  billableWeeks,
  calculateWeeklyCharge,
  chargeStatus,
  latePenalty,
} from "../domain/charges.ts";
import { HttpError } from "../lib/http.ts";

type Db = pg.PoolClient;

export type RulesVersion = { rules: ContractRules; weeklyFee: number; extra: Record<string, unknown> };

/** Regras do contrato em vigor numa data (versão mais recente com effective_from <= data). */
export async function rulesAt(db: Db, date: string): Promise<RulesVersion> {
  const result = await db.query(
    "SELECT weekly_fee, rules FROM contract_rules WHERE effective_from <= $1 ORDER BY effective_from DESC LIMIT 1",
    [date],
  );
  const row = result.rows[0];
  const stored = row?.rules ?? {};
  const rules: ContractRules = {
    ...DEFAULT_RULES,
    ...stored,
    operatingHours: { ...DEFAULT_RULES.operatingHours, ...(stored.operatingHours ?? {}) },
  };
  return { rules, weeklyFee: Number(row?.weekly_fee ?? 130000), extra: stored };
}

async function stopsFor(db: Db, vehicleId: string, driverId: string): Promise<StopPeriod[]> {
  const result = await db.query(
    `SELECT id, start_at, end_at FROM incidents
     WHERE exempts_fee AND validated_at IS NOT NULL AND status IN ('agendada', 'em_curso', 'resolvida')
       AND (vehicle_id = $1 OR driver_id = $2)`,
    [vehicleId, driverId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    startAt: row.start_at.toISOString(),
    endAt: row.end_at ? row.end_at.toISOString() : null,
  }));
}

/** Cria as cobranças semanais em falta de todas as atribuições (idempotente). */
export async function generateWeeklyCharges(db: Db, now: Date): Promise<{ created: number; drivers: string[] }> {
  const assignments = await db.query(
    "SELECT id, vehicle_id, driver_id, start_at, end_at, weekly_fee FROM assignments WHERE start_at < $1",
    [now],
  );
  let created = 0;
  const touchedDrivers = new Set<string>();
  for (const assignment of assignments.rows) {
    const period = {
      startAt: assignment.start_at.toISOString(),
      endAt: assignment.end_at ? assignment.end_at.toISOString() : null,
      weeklyFee: Number(assignment.weekly_fee),
    };
    const { rules: baseRules } = await rulesAt(db, now.toISOString().slice(0, 10));
    const weeks = billableWeeks(period, now.toISOString(), baseRules);
    if (!weeks.length) continue;
    const existing = await db.query(
      "SELECT period_start FROM charges WHERE assignment_id = $1 AND kind = 'semanal' AND status <> 'anulada'",
      [assignment.id],
    );
    const done = new Set(existing.rows.map((row) => row.period_start));
    const missing = weeks.filter((week) => !done.has(week));
    if (!missing.length) continue;
    const stops = await stopsFor(db, assignment.vehicle_id, assignment.driver_id);
    for (const week of missing) {
      const { rules } = await rulesAt(db, week);
      const calc = calculateWeeklyCharge(week, period, stops, rules);
      if (!calc.coveredDays.length) continue;
      await db.query(
        `INSERT INTO charges (kind, driver_id, vehicle_id, assignment_id, period_start, period_end, due_at, amount, status, calculation)
         VALUES ('semanal', $1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT DO NOTHING`,
        [
          assignment.driver_id, assignment.vehicle_id, assignment.id, calc.periodStart, calc.periodEnd, calc.dueAt,
          calc.amount, chargeStatus(calc.amount, 0),
          JSON.stringify({
            weeklyFee: calc.weeklyFee, workingDays: calc.workingDays, coveredDays: calc.coveredDays,
            stoppedDays: calc.stoppedDays, chargedDays: calc.chargedDays, dailyRate: calc.dailyRate,
            incidentIds: calc.stopIds,
          }),
        ],
      );
      created += 1;
      touchedDrivers.add(assignment.driver_id);
    }
  }
  for (const driverId of touchedDrivers) await applyAvailableCredit(db, driverId);
  return { created, drivers: [...touchedDrivers] };
}

/** Recalcula o estado de uma cobrança a partir das alocações. */
async function refreshChargeStatus(db: Db, chargeId: string): Promise<void> {
  await db.query(
    `UPDATE charges c SET status = CASE
        WHEN c.amount <= 0 THEN 'isenta'
        WHEN paid.total >= c.amount THEN 'paga'
        WHEN paid.total > 0 THEN 'parcial'
        ELSE 'aberta' END
     FROM (SELECT coalesce(sum(a.amount), 0) AS total FROM payment_allocations a
           JOIN payments p ON p.id = a.payment_id AND p.voided_at IS NULL
           WHERE a.charge_id = $1) paid
     WHERE c.id = $1 AND c.status <> 'anulada'`,
    [chargeId],
  );
}

async function openChargesForUpdate(db: Db, driverId: string) {
  const result = await db.query(
    `SELECT c.id, c.due_at, c.amount - coalesce((
        SELECT sum(a.amount) FROM payment_allocations a JOIN payments p ON p.id = a.payment_id
        WHERE a.charge_id = c.id AND p.voided_at IS NULL), 0) AS outstanding
     FROM charges c
     WHERE c.driver_id = $1 AND c.status IN ('aberta', 'parcial')
     ORDER BY c.due_at
     FOR UPDATE`,
    [driverId],
  );
  return result.rows.map((row) => ({ id: row.id as string, dueAt: row.due_at.toISOString(), outstanding: Number(row.outstanding) }));
}

/** Usa o saldo não alocado de pagamentos anteriores (crédito) para pagar cobranças em aberto. */
export async function applyAvailableCredit(db: Db, driverId: string): Promise<number> {
  const payments = await db.query(
    `SELECT p.id, p.amount - coalesce(sum(a.amount), 0) AS unallocated
     FROM payments p LEFT JOIN payment_allocations a ON a.payment_id = p.id
     WHERE p.driver_id = $1 AND p.voided_at IS NULL
     GROUP BY p.id HAVING p.amount - coalesce(sum(a.amount), 0) > 0
     ORDER BY min(p.received_at)`,
    [driverId],
  );
  let applied = 0;
  for (const payment of payments.rows) {
    const open = await openChargesForUpdate(db, driverId);
    if (!open.some((charge) => charge.outstanding > 0)) break;
    const { allocations } = allocatePayment(Number(payment.unallocated), open);
    for (const allocation of allocations) {
      await db.query(
        `INSERT INTO payment_allocations (payment_id, charge_id, amount) VALUES ($1, $2, $3)
         ON CONFLICT (payment_id, charge_id) DO UPDATE SET amount = payment_allocations.amount + EXCLUDED.amount`,
        [payment.id, allocation.chargeId, allocation.amount],
      );
      await refreshChargeStatus(db, allocation.chargeId);
      applied += allocation.amount;
    }
  }
  return applied;
}

export type PaymentInput = {
  driverId: string;
  amount: number;
  receivedAt: string;
  method: string;
  reference?: string | null;
  notes?: string | null;
  proofFileId?: string | null;
  clientId?: string | null;
};

export async function recordPayment(db: Db, input: PaymentInput, userId: string | null) {
  if (input.clientId) {
    const existing = await db.query("SELECT id FROM payments WHERE client_id = $1", [input.clientId]);
    if (existing.rowCount) return paymentDetails(db, existing.rows[0].id, true);
  }
  const driver = await db.query("SELECT id FROM drivers WHERE id = $1 AND deleted_at IS NULL FOR UPDATE", [input.driverId]);
  if (!driver.rowCount) throw new HttpError(404, "motorista_inexistente", "Motorista não encontrado.");

  const inserted = await db.query(
    `INSERT INTO payments (driver_id, amount, received_at, method, reference, notes, proof_file_id, client_id, recorded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [input.driverId, input.amount, input.receivedAt, input.method, input.reference ?? null, input.notes ?? null,
      input.proofFileId ?? null, input.clientId ?? null, userId],
  );
  const paymentId = inserted.rows[0].id;
  const open = await openChargesForUpdate(db, input.driverId);
  const { allocations } = open.some((charge) => charge.outstanding > 0)
    ? allocatePayment(input.amount, open)
    : { allocations: [] };
  for (const allocation of allocations) {
    await db.query("INSERT INTO payment_allocations (payment_id, charge_id, amount) VALUES ($1, $2, $3)", [paymentId, allocation.chargeId, allocation.amount]);
    await refreshChargeStatus(db, allocation.chargeId);
  }
  return paymentDetails(db, paymentId, false);
}

async function paymentDetails(db: Db, paymentId: string, replayed: boolean) {
  const payment = await db.query("SELECT * FROM payments WHERE id = $1", [paymentId]);
  const allocations = await db.query(
    `SELECT a.charge_id, a.amount, c.kind, c.period_start FROM payment_allocations a
     JOIN charges c ON c.id = a.charge_id WHERE a.payment_id = $1 ORDER BY c.due_at`,
    [paymentId],
  );
  const allocated = allocations.rows.reduce((sum, row) => sum + Number(row.amount), 0);
  return {
    payment: payment.rows[0],
    allocations: allocations.rows,
    credit: Number(payment.rows[0].amount) - allocated,
    replayed,
  };
}

/**
 * Cria/atualiza penalidades de atraso das cobranças semanais vencidas. O valor nunca desce
 * automaticamente (5 000 → 15 000 quando passa das 24h). Devolve as cobranças com mais de 72h.
 */
export async function applyLatePenalties(db: Db, now: Date) {
  // Vencimentos anteriores a este marco (ex.: dados importados) não recebem penalidades automáticas.
  const marker = await db.query("SELECT value FROM settings WHERE key = 'penalties_from'");
  const penaltiesFrom = marker.rowCount ? new Date(String(marker.rows[0].value)) : new Date(0);
  const result = await db.query(
    `SELECT c.id, c.driver_id, c.vehicle_id, c.assignment_id, c.period_start, c.period_end, c.due_at, c.amount, c.status,
            (SELECT max(p.received_at) FROM payment_allocations a JOIN payments p ON p.id = a.payment_id
             WHERE a.charge_id = c.id AND p.voided_at IS NULL) AS last_payment_at,
            pen.id AS penalty_id, pen.amount AS penalty_amount
     FROM charges c
     LEFT JOIN charges pen ON pen.related_charge_id = c.id AND pen.kind = 'penalidade_atraso' AND pen.status <> 'anulada'
     WHERE c.kind = 'semanal' AND c.status IN ('aberta', 'parcial', 'paga') AND c.amount > 0
       AND c.due_at < $1 AND c.due_at >= $2`,
    [now, penaltiesFrom],
  );
  const breaches: { chargeId: string; driverId: string; delayHours: number }[] = [];
  let changed = 0;
  for (const charge of result.rows) {
    const { rules } = await rulesAt(db, charge.period_start);
    const settledAt = charge.status === "paga" && charge.last_payment_at ? charge.last_payment_at.toISOString() : null;
    const penalty = latePenalty({ amount: Number(charge.amount), dueAt: charge.due_at.toISOString() }, settledAt, now.toISOString(), rules);
    if (penalty.breachAlert && !settledAt) breaches.push({ chargeId: charge.id, driverId: charge.driver_id, delayHours: Math.floor(penalty.delayHours) });
    if (!penalty.amount) continue;
    if (!charge.penalty_id) {
      await db.query(
        `INSERT INTO charges (kind, driver_id, vehicle_id, assignment_id, period_start, period_end, due_at, amount, status, related_charge_id, description)
         VALUES ('penalidade_atraso', $1, $2, $3, $4, $5, $6, $7, 'aberta', $8, $9)
         ON CONFLICT DO NOTHING`,
        [charge.driver_id, charge.vehicle_id, charge.assignment_id, charge.period_start, charge.period_end, now,
          penalty.amount, charge.id, `Atraso na entrega da semana de ${charge.period_start}`],
      );
      changed += 1;
    } else if (Number(charge.penalty_amount) < penalty.amount) {
      await db.query("UPDATE charges SET amount = $2 WHERE id = $1", [charge.penalty_id, penalty.amount]);
      await refreshChargeStatus(db, charge.penalty_id);
      changed += 1;
    }
  }
  return { changed, breaches };
}

export async function driverStatement(db: Db, driverId: string) {
  const driver = await db.query("SELECT id, name, phone FROM drivers WHERE id = $1 AND deleted_at IS NULL", [driverId]);
  if (!driver.rowCount) throw new HttpError(404, "motorista_inexistente", "Motorista não encontrado.");
  const charges = await db.query(
    `SELECT c.id, c.kind, c.period_start, c.period_end, c.due_at, c.amount, c.status, c.calculation, c.description,
            c.related_charge_id, c.vehicle_id,
            coalesce((SELECT sum(a.amount) FROM payment_allocations a JOIN payments p ON p.id = a.payment_id
                      WHERE a.charge_id = c.id AND p.voided_at IS NULL), 0) AS paid
     FROM charges c WHERE c.driver_id = $1 AND c.status <> 'anulada' ORDER BY c.due_at DESC`,
    [driverId],
  );
  const payments = await db.query(
    `SELECT id, amount, received_at, method, reference, notes FROM payments
     WHERE driver_id = $1 AND voided_at IS NULL ORDER BY received_at DESC`,
    [driverId],
  );
  const totalCharged = charges.rows.reduce((sum, row) => sum + Number(row.amount), 0);
  const totalPaid = payments.rows.reduce((sum, row) => sum + Number(row.amount), 0);
  const now = Date.now();
  const overdue = charges.rows
    .filter((row) => ["aberta", "parcial"].includes(row.status) && row.due_at.getTime() < now)
    .reduce((sum, row) => sum + Number(row.amount) - Number(row.paid), 0);
  return {
    driver: driver.rows[0],
    totals: { charged: totalCharged, paid: totalPaid, balance: totalCharged - totalPaid, overdue },
    charges: charges.rows.map((row) => ({ ...row, outstanding: Number(row.amount) - Number(row.paid) })),
    payments: payments.rows,
  };
}
