// API v1 (app Flutter). Montada em /api/v1 pelo server.js, em paralelo com a API do PWA.
import express, { type NextFunction, type Request, type Response, Router } from "express";
import type pg from "pg";
import { z } from "zod";
import { pool } from "../db.js";
import { type AuthedRequest, HttpError, errorHandler, parse, route } from "../lib/http.ts";
import { type AccessClaims, verifyJwt } from "../lib/security.ts";
import { activateDriver, createStaffUser, inviteDriver, jwtSecret, login, logout, refresh } from "../services/auth.ts";
import { applyLatePenalties, driverStatement, generateWeeklyCharges, recordPayment } from "../services/billing.ts";

export async function withTransaction<T>(work: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function authenticate(request: Request, _response: Response, next: NextFunction) {
  const header = request.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const claims = token ? verifyJwt(token, jwtSecret()) : null;
  if (!claims) {
    next(new HttpError(401, "nao_autenticado", "Sessão inválida ou expirada."));
    return;
  }
  (request as AuthedRequest).user = claims;
  next();
}

function requireRole(...roles: AccessClaims["role"][]) {
  return (request: Request, _response: Response, next: NextFunction) => {
    const { user } = request as AuthedRequest;
    if (!roles.includes(user.role)) {
      next(new HttpError(403, "sem_permissao", "Sem permissão para esta operação."));
      return;
    }
    next();
  };
}

/** Motorista só pode ver o que é seu; gestor/admin veem tudo. */
function assertDriverAccess(user: AccessClaims, driverId: string) {
  if (user.role === "motorista" && user.driverId !== driverId) {
    throw new HttpError(403, "sem_permissao", "Sem permissão para esta operação.");
  }
}

const uuid = z.uuid();
const staff = requireRole("admin", "gestor");

export function createV1Router(): Router {
  const router = Router();
  router.use(express.json({ limit: "1mb" }));

  // --- autenticação --------------------------------------------------------------------------
  router.post("/auth/login", route(async (request, response) => {
    const body = parse(z.object({ login: z.string().min(3), password: z.string().min(4) }), request.body);
    response.json(await login(pool, body.login, body.password, request.get("user-agent")));
  }));

  router.post("/auth/refresh", route(async (request, response) => {
    const body = parse(z.object({ refreshToken: z.string().min(20) }), request.body);
    const session = await withTransaction((db) => refresh(db, body.refreshToken, request.get("user-agent")));
    if (!session) throw new HttpError(401, "sessao_invalida", "Sessão expirada. Entre novamente.");
    response.json(session);
  }));

  router.post("/auth/logout", route(async (request, response) => {
    const body = parse(z.object({ refreshToken: z.string().min(20) }), request.body);
    await logout(pool, body.refreshToken);
    response.json({ ok: true });
  }));

  router.post("/auth/activate", route(async (request, response) => {
    const body = parse(z.object({
      phone: z.string().min(9),
      code: z.string().regex(/^\d{6}$/, "Código de 6 dígitos."),
      pin: z.string().regex(/^\d{6}$/, "PIN de 6 dígitos."),
    }), request.body);
    response.json(await withTransaction((db) => activateDriver(db, body.phone, body.code, body.pin, request.get("user-agent"))));
  }));

  router.use(authenticate);

  router.get("/me", route(async (request, response) => {
    const result = await pool.query(
      "SELECT id, name, email, phone, role, driver_id AS \"driverId\", last_login_at AS \"lastLoginAt\" FROM users WHERE id = $1 AND active",
      [request.user.sub],
    );
    if (!result.rowCount) throw new HttpError(401, "nao_autenticado", "Conta desativada.");
    response.json(result.rows[0]);
  }));

  // --- motorista (o próprio) ----------------------------------------------------------------
  router.get("/me/statement", requireRole("motorista"), route(async (request, response) => {
    const client = await pool.connect();
    try {
      response.json(await driverStatement(client, request.user.driverId!));
    } finally {
      client.release();
    }
  }));

  // --- gestão --------------------------------------------------------------------------------
  router.post("/users", requireRole("admin"), route(async (request, response) => {
    const body = parse(z.object({
      name: z.string().min(2),
      email: z.email().optional(),
      phone: z.string().min(9).optional(),
      role: z.enum(["admin", "gestor"]),
      password: z.string().min(10, "Mínimo 10 caracteres."),
    }).refine((value) => value.email || value.phone, "Indique email ou telefone."), request.body);
    response.status(201).json(await createStaffUser(pool, body));
  }));

  router.get("/drivers", staff, route(async (_request, response) => {
    const result = await pool.query(
      `SELECT d.id, d.name, d.phone,
              a.id AS "assignmentId", v.id AS "vehicleId", v.plate, v.brand, v.model,
              coalesce(ch.total, 0) - coalesce(pay.total, 0) AS balance,
              u.id IS NOT NULL AND u.pin_hash IS NOT NULL AS "hasAppAccess"
       FROM drivers d
       LEFT JOIN assignments a ON a.driver_id = d.id AND a.status = 'ativa'
       LEFT JOIN vehicles v ON v.id = a.vehicle_id
       LEFT JOIN users u ON u.driver_id = d.id
       LEFT JOIN LATERAL (SELECT sum(amount) AS total FROM charges WHERE driver_id = d.id AND status <> 'anulada') ch ON true
       LEFT JOIN LATERAL (SELECT sum(amount) AS total FROM payments WHERE driver_id = d.id AND voided_at IS NULL) pay ON true
       WHERE d.deleted_at IS NULL
       ORDER BY d.name`,
    );
    response.json(result.rows);
  }));

  router.get("/drivers/:id/statement", route(async (request, response) => {
    const driverId = parse(uuid, request.params.id);
    assertDriverAccess(request.user, driverId);
    const client = await pool.connect();
    try {
      response.json(await driverStatement(client, driverId));
    } finally {
      client.release();
    }
  }));

  router.post("/drivers/:id/invite", staff, route(async (request, response) => {
    const driverId = parse(uuid, request.params.id);
    response.json(await withTransaction((db) => inviteDriver(db, driverId)));
  }));

  router.get("/charges", staff, route(async (request, response) => {
    const query = parse(z.object({
      driverId: uuid.optional(),
      status: z.enum(["aberta", "parcial", "paga", "isenta", "anulada"]).optional(),
      periodStart: z.iso.date().optional(),
    }), request.query);
    const result = await pool.query(
      `SELECT c.*, d.name AS driver_name, v.plate,
              coalesce((SELECT sum(a.amount) FROM payment_allocations a JOIN payments p ON p.id = a.payment_id
                        WHERE a.charge_id = c.id AND p.voided_at IS NULL), 0) AS paid
       FROM charges c JOIN drivers d ON d.id = c.driver_id LEFT JOIN vehicles v ON v.id = c.vehicle_id
       WHERE ($1::uuid IS NULL OR c.driver_id = $1)
         AND ($2::text IS NULL OR c.status = $2)
         AND ($3::date IS NULL OR c.period_start = $3)
       ORDER BY c.due_at DESC, d.name
       LIMIT 500`,
      [query.driverId ?? null, query.status ?? null, query.periodStart ?? null],
    );
    response.json(result.rows);
  }));

  router.post("/payments", staff, route(async (request, response) => {
    const body = parse(z.object({
      driverId: uuid,
      amount: z.number().int().positive(),
      receivedAt: z.iso.datetime({ offset: true }),
      method: z.enum(["numerario", "transferencia", "multicaixa", "deposito", "outro"]),
      reference: z.string().max(200).nullish(),
      notes: z.string().max(2000).nullish(),
      proofFileId: uuid.nullish(),
      clientId: uuid.nullish(),
    }), request.body);
    const result = await withTransaction((db) => recordPayment(db, body, request.user.sub));
    response.status(result.replayed ? 200 : 201).json(result);
  }));

  router.post("/admin/jobs/billing", requireRole("admin"), route(async (_request, response) => {
    response.json(await runBillingJobs(new Date()));
  }));

  router.use((_request, _response, next) => next(new HttpError(404, "nao_encontrado", "Rota inexistente.")));
  router.use(errorHandler);
  return router;
}

const BILLING_LOCK_ID = 727275;

/** Gera cobranças em falta e penalidades. Seguro de correr em várias instâncias (advisory lock). */
export async function runBillingJobs(now: Date) {
  return withTransaction(async (db) => {
    const lock = await db.query("SELECT pg_try_advisory_xact_lock($1) AS ok", [BILLING_LOCK_ID]);
    if (!lock.rows[0].ok) return { skipped: true };
    const charges = await generateWeeklyCharges(db, now);
    const penalties = await applyLatePenalties(db, now);
    return { skipped: false, chargesCreated: charges.created, penaltiesChanged: penalties.changed, breaches: penalties.breaches };
  });
}
