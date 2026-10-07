// Atribuições (atribuir/devolver) e ocorrências (comunicar, validar, resolver, cancelar).
import type { Router } from "express";
import { z } from "zod";
import { pool } from "../../db.js";
import { HttpError, parse, route } from "../../lib/http.ts";
import { rulesAt } from "../../services/billing.ts";
import { applyIncidentEffects, assignVehicle, incidentStatusAt, returnVehicle } from "../../services/fleet.ts";
import {
  type Db, assertDriverAccess, audit, isoDateTime, kz, notFound, optionalText, staff, updateColumns, uuid, withTransaction,
} from "../context.ts";

const handoverSchema = z.object({
  mileage: z.number().int().nonnegative().nullish(),
  fuelLevel: z.enum(["vazio", "reserva", "um_quarto", "meio", "tres_quartos", "cheio"]).nullish(),
  checklist: z.record(z.string(), z.boolean()).optional(),
  photoFileIds: z.array(uuid).max(12).optional(),
  damages: optionalText(2000),
}).partial();

const INCIDENT_TYPES = [
  "doenca", "licenca", "manutencao", "paragem_tecnica", "sinistro", "avaria", "multa", "fora_horario",
  "vistoria", "gps", "furto", "outro",
] as const;
const EXEMPT_BY_DEFAULT = new Set(["doenca", "licenca", "manutencao", "paragem_tecnica", "sinistro", "avaria"]);

const incidentFields = z.object({
  type: z.enum(INCIDENT_TYPES),
  vehicleId: uuid.nullish(),
  driverId: uuid.nullish(),
  startAt: isoDateTime,
  endAt: isoDateTime.nullish(),
  exemptsFee: z.boolean().optional(),
  immobilizes: z.boolean().optional(),
  releasesAssignment: z.boolean().optional(),
  amount: kz.optional(),
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  notes: optionalText(2000),
  attachmentIds: z.array(uuid).max(10).optional(),
});

function assertPeriod(startAt: string, endAt: string | null | undefined) {
  if (endAt && endAt < startAt) throw new HttpError(422, "periodo_invalido", "O fim não pode ser antes do início.");
}

async function defaultAmount(db: Db, type: string, startAt: string, amount: number | undefined) {
  if (amount !== undefined) return amount;
  if (type !== "fora_horario") return 0;
  const { extra } = await rulesAt(db, startAt.slice(0, 10));
  return Number(extra.fineOffHours ?? 50000);
}

async function attach(db: Db, incidentId: string, fileIds: string[] | undefined) {
  for (const fileId of fileIds ?? []) {
    await db.query("INSERT INTO incident_attachments (incident_id, file_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [incidentId, fileId]);
  }
}

async function loadIncident(db: Db, id: string) {
  const result = await db.query("SELECT * FROM incidents WHERE id = $1 FOR UPDATE", [id]);
  if (!result.rowCount) throw notFound("Ocorrência");
  return result.rows[0];
}

export function registerOperationRoutes(router: Router) {
  // --- atribuições ---------------------------------------------------------------------------
  router.get("/assignments", staff, route(async (request, response) => {
    const query = parse(z.object({
      status: z.enum(["ativa", "encerrada", "substituida", "rescindida"]).optional(),
      vehicleId: uuid.optional(),
      driverId: uuid.optional(),
    }), request.query);
    const result = await pool.query(
      `SELECT a.*, d.name AS driver_name, v.plate, v.brand, v.model
       FROM assignments a JOIN drivers d ON d.id = a.driver_id JOIN vehicles v ON v.id = a.vehicle_id
       WHERE ($1::text IS NULL OR a.status = $1) AND ($2::uuid IS NULL OR a.vehicle_id = $2) AND ($3::uuid IS NULL OR a.driver_id = $3)
       ORDER BY a.status = 'ativa' DESC, a.start_at DESC LIMIT 500`,
      [query.status ?? null, query.vehicleId ?? null, query.driverId ?? null],
    );
    response.json(result.rows);
  }));

  router.post("/assignments", staff, route(async (request, response) => {
    const body = parse(z.object({
      vehicleId: uuid,
      driverId: uuid,
      startAt: isoDateTime,
      weeklyFee: kz.nullish(),
      depositReceived: kz.optional(),
      handover: handoverSchema.optional(),
      notes: optionalText(2000),
    }), request.body);
    const assignment = await withTransaction(async (db) => {
      const created = await assignVehicle(db, body, request.user.sub);
      await audit(db, request.user.sub, "assignment", created.id, "create", body);
      return created;
    });
    response.status(201).json(assignment);
  }));

  router.post("/assignments/:id/return", staff, route(async (request, response) => {
    const id = parse(uuid, request.params.id);
    const body = parse(z.object({
      endAt: isoDateTime,
      reason: z.enum(["devolucao", "substituida", "rescindida"]).default("devolucao"),
      returnInfo: handoverSchema.optional(),
      applyDeposit: z.boolean().default(false),
    }), request.body);
    const result = await withTransaction(async (db) => {
      const closed = await returnVehicle(db, id, body, request.user.sub);
      await audit(db, request.user.sub, "assignment", id, "return", { ...body, settlement: closed.settlement });
      return closed;
    });
    response.json(result);
  }));

  // --- ocorrências ---------------------------------------------------------------------------
  router.get("/incidents", staff, route(async (request, response) => {
    const query = parse(z.object({
      status: z.enum(["por_validar", "agendada", "em_curso", "resolvida", "cancelada"]).optional(),
      vehicleId: uuid.optional(),
      driverId: uuid.optional(),
    }), request.query);
    const result = await pool.query(
      `SELECT i.*, d.name AS driver_name, v.plate,
              (SELECT coalesce(json_agg(ia.file_id), '[]') FROM incident_attachments ia WHERE ia.incident_id = i.id) AS attachment_ids
       FROM incidents i LEFT JOIN drivers d ON d.id = i.driver_id LEFT JOIN vehicles v ON v.id = i.vehicle_id
       WHERE ($1::text IS NULL OR i.status = $1) AND ($2::uuid IS NULL OR i.vehicle_id = $2) AND ($3::uuid IS NULL OR i.driver_id = $3)
       ORDER BY i.status = 'por_validar' DESC, i.start_at DESC LIMIT 500`,
      [query.status ?? null, query.vehicleId ?? null, query.driverId ?? null],
    );
    response.json(result.rows);
  }));

  router.get("/incidents/:id", route(async (request, response) => {
    const id = parse(uuid, request.params.id);
    const result = await pool.query(
      `SELECT i.*, (SELECT coalesce(json_agg(ia.file_id), '[]') FROM incident_attachments ia WHERE ia.incident_id = i.id) AS attachment_ids
       FROM incidents i WHERE i.id = $1`,
      [id],
    );
    if (!result.rowCount) throw notFound("Ocorrência");
    assertDriverAccess(request.user, result.rows[0].driver_id);
    response.json(result.rows[0]);
  }));

  /**
   * Gestor: ocorrência validada de imediato. Motorista: fica "por_validar" (sem efeito nas cobranças
   * até o gestor validar), ligada a si e à viatura que tem atribuída; a hora de comunicação fica registada.
   */
  router.post("/incidents", route(async (request, response) => {
    const body = parse(incidentFields, request.body);
    assertPeriod(body.startAt, body.endAt);
    const isDriver = request.user.role === "motorista";
    const incident = await withTransaction(async (db) => {
      let { vehicleId, driverId } = body;
      if (isDriver) {
        driverId = request.user.driverId;
        const active = await db.query("SELECT vehicle_id FROM assignments WHERE driver_id = $1 AND status = 'ativa'", [driverId]);
        vehicleId = active.rows[0]?.vehicle_id ?? null;
      } else if (vehicleId && !driverId) {
        const active = await db.query("SELECT driver_id FROM assignments WHERE vehicle_id = $1 AND status = 'ativa'", [vehicleId]);
        driverId = active.rows[0]?.driver_id ?? null;
      }
      if (!vehicleId && !driverId) throw new HttpError(422, "sem_alvo", "Indique a viatura ou o motorista.");
      const amount = await defaultAmount(db, body.type, body.startAt, body.amount);
      const status = isDriver ? "por_validar" : incidentStatusAt(body.startAt, body.endAt ?? null, new Date());
      const result = await db.query(
        `INSERT INTO incidents (type, vehicle_id, driver_id, start_at, end_at, status, exempts_fee, immobilizes,
                                releases_assignment, amount, reported_by, validated_by, validated_at, latitude, longitude, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING *`,
        [body.type, vehicleId, driverId, body.startAt, body.endAt ?? null, status,
          body.exemptsFee ?? EXEMPT_BY_DEFAULT.has(body.type), body.immobilizes ?? false, body.releasesAssignment ?? false,
          amount, request.user.sub, isDriver ? null : request.user.sub, isDriver ? null : new Date(),
          body.latitude ?? null, body.longitude ?? null, body.notes],
      );
      const created = result.rows[0];
      await attach(db, created.id, body.attachmentIds);
      if (!isDriver) await applyIncidentEffects(db, created.id);
      await audit(db, request.user.sub, "incident", created.id, "create", { type: body.type, status });
      return (await db.query("SELECT * FROM incidents WHERE id = $1", [created.id])).rows[0];
    });
    response.status(201).json(incident);
  }));

  router.post("/incidents/:id/validate", staff, route(async (request, response) => {
    const id = parse(uuid, request.params.id);
    const body = parse(incidentFields.pick({
      startAt: true, endAt: true, exemptsFee: true, immobilizes: true, releasesAssignment: true, amount: true, notes: true,
    }).partial(), request.body);
    const incident = await withTransaction(async (db) => {
      const current = await loadIncident(db, id);
      if (current.status !== "por_validar") throw new HttpError(409, "ja_validada", "A ocorrência já foi validada.");
      const startAt = body.startAt ?? current.start_at.toISOString();
      const endAt = body.endAt === undefined ? current.end_at?.toISOString() ?? null : body.endAt;
      assertPeriod(startAt, endAt);
      await updateColumns(db, "incidents", id, {
        start_at: startAt, end_at: endAt, exempts_fee: body.exemptsFee, immobilizes: body.immobilizes,
        releases_assignment: body.releasesAssignment, amount: body.amount, notes: body.notes,
        status: incidentStatusAt(startAt, endAt, new Date()), validated_by: request.user.sub, validated_at: new Date(),
      });
      await applyIncidentEffects(db, id, current);
      await audit(db, request.user.sub, "incident", id, "validate", body);
      return (await db.query("SELECT * FROM incidents WHERE id = $1", [id])).rows[0];
    });
    response.json(incident);
  }));

  router.patch("/incidents/:id", staff, route(async (request, response) => {
    const id = parse(uuid, request.params.id);
    const body = parse(incidentFields.omit({ vehicleId: true, driverId: true, attachmentIds: true }).partial(), request.body);
    const incident = await withTransaction(async (db) => {
      const current = await loadIncident(db, id);
      if (current.status === "cancelada") throw new HttpError(409, "cancelada", "Ocorrência cancelada não pode ser editada.");
      const startAt = body.startAt ?? current.start_at.toISOString();
      const endAt = body.endAt === undefined ? current.end_at?.toISOString() ?? null : body.endAt;
      assertPeriod(startAt, endAt);
      const status = current.status === "por_validar" ? "por_validar" : incidentStatusAt(startAt, endAt, new Date());
      await updateColumns(db, "incidents", id, {
        type: body.type, start_at: startAt, end_at: endAt, exempts_fee: body.exemptsFee, immobilizes: body.immobilizes,
        releases_assignment: body.releasesAssignment, amount: body.amount, notes: body.notes,
        latitude: body.latitude, longitude: body.longitude, status,
      });
      if (current.validated_at) await applyIncidentEffects(db, id, current);
      await audit(db, request.user.sub, "incident", id, "update", body);
      return (await db.query("SELECT * FROM incidents WHERE id = $1", [id])).rows[0];
    });
    response.json(incident);
  }));

  router.post("/incidents/:id/resolve", staff, route(async (request, response) => {
    const id = parse(uuid, request.params.id);
    const body = parse(z.object({ endAt: isoDateTime.optional(), notes: optionalText(2000) }), request.body ?? {});
    const incident = await withTransaction(async (db) => {
      const current = await loadIncident(db, id);
      if (!["agendada", "em_curso"].includes(current.status)) {
        throw new HttpError(409, "estado_invalido", "Só se resolvem ocorrências validadas e não terminadas.");
      }
      const endAt = body.endAt ?? new Date().toISOString();
      assertPeriod(current.start_at.toISOString(), endAt);
      await updateColumns(db, "incidents", id, { end_at: endAt, status: "resolvida", notes: body.notes ?? undefined });
      await applyIncidentEffects(db, id, current);
      await audit(db, request.user.sub, "incident", id, "resolve", { endAt });
      return (await db.query("SELECT * FROM incidents WHERE id = $1", [id])).rows[0];
    });
    response.json(incident);
  }));

  router.post("/incidents/:id/cancel", staff, route(async (request, response) => {
    const id = parse(uuid, request.params.id);
    const body = parse(z.object({ reason: z.string().trim().min(3).max(500) }), request.body);
    const incident = await withTransaction(async (db) => {
      const current = await loadIncident(db, id);
      if (current.status === "cancelada") throw new HttpError(409, "ja_cancelada", "A ocorrência já está cancelada.");
      await updateColumns(db, "incidents", id, {
        status: "cancelada",
        notes: [current.notes, `Cancelada: ${body.reason}`].filter(Boolean).join("\n"),
      });
      await applyIncidentEffects(db, id, current);
      await audit(db, request.user.sub, "incident", id, "cancel", body);
      return (await db.query("SELECT * FROM incidents WHERE id = $1", [id])).rows[0];
    });
    response.json(incident);
  }));
}
