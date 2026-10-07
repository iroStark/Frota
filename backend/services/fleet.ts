// Atribuições, ocorrências e estado das viaturas.
// O estado da viatura é sempre derivado (nunca escrito pelo cliente), exceto "abatida".
import type pg from "pg";
import { localDateOf, parseInstant } from "../domain/time.ts";
import { HttpError } from "../lib/http.ts";
import { driverStatement, generateChargesForAssignment, recalculateWeeklyCharges, recordPayment, syncIncidentCharge } from "./billing.ts";

type Db = pg.PoolClient;
const LUANDA_OFFSET = 60;

export async function refreshVehicleStatus(db: Db, vehicleId: string, now = new Date()): Promise<string> {
  const result = await db.query(
    `UPDATE vehicles v SET status = CASE
        WHEN v.status = 'abatida' THEN 'abatida'
        WHEN EXISTS (SELECT 1 FROM incidents i WHERE i.vehicle_id = v.id AND i.immobilizes AND i.validated_at IS NOT NULL
                     AND i.status = 'em_curso' AND i.start_at <= $2 AND (i.end_at IS NULL OR i.end_at > $2)) THEN 'imobilizada'
        WHEN EXISTS (SELECT 1 FROM assignments a WHERE a.vehicle_id = v.id AND a.status = 'ativa') THEN 'em_servico'
        ELSE 'disponivel' END
     WHERE v.id = $1 RETURNING status`,
    [vehicleId, now],
  );
  return result.rows[0]?.status;
}

// --- atribuições ------------------------------------------------------------------------------

export type AssignInput = {
  vehicleId: string;
  driverId: string;
  startAt: string;
  weeklyFee?: number | null;
  depositReceived?: number;
  handover?: Record<string, unknown>;
  notes?: string | null;
};

export async function assignVehicle(db: Db, input: AssignInput, userId: string) {
  const vehicle = await db.query("SELECT id, status FROM vehicles WHERE id = $1 AND deleted_at IS NULL FOR UPDATE", [input.vehicleId]);
  if (!vehicle.rowCount) throw new HttpError(404, "nao_encontrado", "Viatura não encontrada.");
  const driver = await db.query("SELECT id FROM drivers WHERE id = $1 AND deleted_at IS NULL FOR UPDATE", [input.driverId]);
  if (!driver.rowCount) throw new HttpError(404, "nao_encontrado", "Motorista não encontrado.");
  const status = await refreshVehicleStatus(db, input.vehicleId);
  if (status === "imobilizada" || status === "abatida") {
    throw new HttpError(409, "viatura_indisponivel", `A viatura está ${status} e não pode ser atribuída.`);
  }
  const busy = await db.query(
    "SELECT vehicle_id, driver_id FROM assignments WHERE status = 'ativa' AND (vehicle_id = $1 OR driver_id = $2)",
    [input.vehicleId, input.driverId],
  );
  if (busy.rows.some((row) => row.vehicle_id === input.vehicleId)) {
    throw new HttpError(409, "viatura_atribuida", "A viatura já está atribuída. Devolva-a primeiro.");
  }
  if (busy.rowCount) throw new HttpError(409, "motorista_ocupado", "O motorista já tem uma viatura atribuída.");

  const rules = await db.query("SELECT weekly_fee FROM contract_rules WHERE effective_from <= $1::date ORDER BY effective_from DESC LIMIT 1", [input.startAt.slice(0, 10)]);
  const result = await db.query(
    `INSERT INTO assignments (vehicle_id, driver_id, start_at, weekly_fee, deposit_received, handover, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [input.vehicleId, input.driverId, input.startAt, input.weeklyFee ?? Number(rules.rows[0]?.weekly_fee ?? 130000),
      input.depositReceived ?? 0, JSON.stringify(input.handover ?? {}), input.notes ?? null, userId],
  );
  const mileage = Number(input.handover?.mileage);
  if (Number.isFinite(mileage) && mileage > 0) {
    await db.query("UPDATE vehicles SET mileage = greatest(coalesce(mileage, 0), $2) WHERE id = $1", [input.vehicleId, mileage]);
  }
  await refreshVehicleStatus(db, input.vehicleId);
  return result.rows[0];
}

export type ReturnInput = {
  endAt: string;
  reason: "devolucao" | "substituida" | "rescindida";
  returnInfo?: Record<string, unknown>;
  /** Usar a caução para abater a dívida do motorista. */
  applyDeposit?: boolean;
};

/**
 * Devolve a viatura: fecha a atribuição, cobra a última semana (por dias) e calcula o acerto
 * (dívida, caução a devolver ou a reter).
 */
export async function returnVehicle(db: Db, assignmentId: string, input: ReturnInput, userId: string) {
  const current = await db.query("SELECT * FROM assignments WHERE id = $1 FOR UPDATE", [assignmentId]);
  const assignment = current.rows[0];
  if (!assignment) throw new HttpError(404, "nao_encontrado", "Atribuição não encontrada.");
  if (assignment.status !== "ativa") throw new HttpError(409, "ja_encerrada", "A atribuição já está encerrada.");
  if (parseInstant(input.endAt) < assignment.start_at.getTime()) {
    throw new HttpError(422, "data_invalida", "A devolução não pode ser antes do início da atribuição.");
  }
  const status = input.reason === "devolucao" ? "encerrada" : input.reason;
  const updated = await db.query(
    "UPDATE assignments SET status = $2, end_at = $3, end_reason = $4, return_info = $5 WHERE id = $1 RETURNING *",
    [assignmentId, status, input.endAt, input.reason, JSON.stringify(input.returnInfo ?? {})],
  );
  const closed = updated.rows[0];
  await generateChargesForAssignment(db, closed, new Date(), true);
  const mileage = Number(input.returnInfo?.mileage);
  if (Number.isFinite(mileage) && mileage > 0) {
    await db.query("UPDATE vehicles SET mileage = greatest(coalesce(mileage, 0), $2) WHERE id = $1", [closed.vehicle_id, mileage]);
  }
  await refreshVehicleStatus(db, closed.vehicle_id);

  let statement = await driverStatement(db, closed.driver_id);
  const deposit = Number(closed.deposit_received);
  let depositApplied = 0;
  if (input.applyDeposit && deposit > 0 && statement.totals.balance > 0) {
    depositApplied = Math.min(deposit, statement.totals.balance);
    await recordPayment(db, {
      driverId: closed.driver_id, amount: depositApplied, receivedAt: input.endAt, method: "caucao",
      notes: "Caução usada no acerto da devolução.",
    }, userId);
    statement = await driverStatement(db, closed.driver_id);
  }
  const balance = statement.totals.balance;
  return {
    assignment: closed,
    settlement: {
      deposit,
      depositApplied,
      depositToReturn: Math.max(0, deposit - depositApplied - Math.max(0, balance)),
      balance,
      remainingDebt: Math.max(0, balance),
      credit: Math.max(0, -balance),
    },
  };
}

// --- ocorrências ------------------------------------------------------------------------------

export function incidentStatusAt(startAt: string, endAt: string | null, now: Date): "agendada" | "em_curso" | "resolvida" {
  const nowMs = now.getTime();
  if (nowMs < parseInstant(startAt)) return "agendada";
  if (endAt && nowMs >= parseInstant(endAt)) return "resolvida";
  return "em_curso";
}

/** Efeitos de uma ocorrência validada: encerra a atribuição (se pedido), estado da viatura e cobranças. */
export async function applyIncidentEffects(db: Db, incidentId: string, previous?: { start_at: Date } | null, now = new Date()) {
  const result = await db.query("SELECT * FROM incidents WHERE id = $1", [incidentId]);
  const incident = result.rows[0];
  if (!incident) return;
  if (incident.validated_at && incident.status === "em_curso" && incident.releases_assignment && !incident.immobilization_applied && incident.vehicle_id) {
    const active = await db.query("SELECT id, start_at FROM assignments WHERE vehicle_id = $1 AND status = 'ativa' FOR UPDATE", [incident.vehicle_id]);
    if (active.rowCount) {
      const endAt = new Date(Math.max(incident.start_at.getTime(), active.rows[0].start_at.getTime()));
      await db.query(
        "UPDATE assignments SET status = 'encerrada', end_at = $2, end_reason = 'ocorrencia' WHERE id = $1",
        [active.rows[0].id, endAt],
      );
    }
    await db.query("UPDATE incidents SET immobilization_applied = true WHERE id = $1", [incidentId]);
  }
  if (incident.vehicle_id) await refreshVehicleStatus(db, incident.vehicle_id, now);
  const starts = [incident.start_at.getTime(), previous?.start_at?.getTime() ?? Number.POSITIVE_INFINITY];
  const fromDate = localDateOf(Math.min(...starts), LUANDA_OFFSET);
  await recalculateWeeklyCharges(db, { vehicleId: incident.vehicle_id, driverId: incident.driver_id }, fromDate);
  await syncIncidentCharge(db, incidentId);
}

/** Avança as ocorrências validadas com o tempo (agendada → em curso → resolvida). */
export async function syncIncidentStates(db: Db, now: Date) {
  const result = await db.query(
    `SELECT id, start_at, end_at, status FROM incidents
     WHERE validated_at IS NOT NULL AND status IN ('agendada', 'em_curso')`,
  );
  let changed = 0;
  for (const incident of result.rows) {
    const next = incidentStatusAt(incident.start_at.toISOString(), incident.end_at?.toISOString() ?? null, now);
    if (next === incident.status) continue;
    await db.query("UPDATE incidents SET status = $2 WHERE id = $1", [incident.id, next]);
    await applyIncidentEffects(db, incident.id, null, now);
    changed += 1;
  }
  return { changed };
}
