import type { Router } from "express";
import { z } from "zod";
import { pool } from "../../db.js";
import { HttpError, parse, route } from "../../lib/http.ts";
import { activateDriver, createStaffUser, inviteDriver, login, logout, refresh } from "../../services/auth.ts";
import { audit, requireRole, staff, uuid, withTransaction } from "../context.ts";

/** Rotas públicas (antes da autenticação). */
export function registerPublicAuthRoutes(router: Router) {
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
}

export function registerAccountRoutes(router: Router) {
  router.get("/me", route(async (request, response) => {
    const result = await pool.query(
      `SELECT id, name, email, phone, role, driver_id AS "driverId", last_login_at AS "lastLoginAt"
       FROM users WHERE id = $1 AND active`,
      [request.user.sub],
    );
    if (!result.rowCount) throw new HttpError(401, "nao_autenticado", "Conta desativada.");
    response.json(result.rows[0]);
  }));

  router.get("/users", requireRole("admin"), route(async (_request, response) => {
    const result = await pool.query(
      `SELECT id, name, email, phone, role, driver_id AS "driverId", active, last_login_at AS "lastLoginAt"
       FROM users ORDER BY role, name`,
    );
    response.json(result.rows);
  }));

  router.post("/users", requireRole("admin"), route(async (request, response) => {
    const body = parse(z.object({
      name: z.string().min(2),
      email: z.email().optional(),
      phone: z.string().min(9).optional(),
      role: z.enum(["admin", "gestor"]),
      password: z.string().min(10, "Mínimo 10 caracteres."),
    }).refine((value) => value.email || value.phone, "Indique email ou telefone."), request.body);
    const user = await createStaffUser(pool, body);
    await audit(pool, request.user.sub, "user", user.id, "create", { name: user.name, role: user.role });
    response.status(201).json(user);
  }));

  router.patch("/users/:id", requireRole("admin"), route(async (request, response) => {
    const id = parse(uuid, request.params.id);
    const body = parse(z.object({ active: z.boolean() }), request.body);
    if (id === request.user.sub && !body.active) throw new HttpError(422, "auto_desativar", "Não pode desativar a sua própria conta.");
    const result = await withTransaction(async (db) => {
      const updated = await db.query("UPDATE users SET active = $2 WHERE id = $1 RETURNING id, name, role, active", [id, body.active]);
      if (!updated.rowCount) throw new HttpError(404, "nao_encontrado", "Utilizador não encontrado.");
      if (!body.active) await db.query("UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [id]);
      await audit(db, request.user.sub, "user", id, body.active ? "activate" : "deactivate");
      return updated.rows[0];
    });
    response.json(result);
  }));

  router.post("/drivers/:id/invite", staff, route(async (request, response) => {
    const driverId = parse(uuid, request.params.id);
    const invite = await withTransaction(async (db) => {
      const result = await inviteDriver(db, driverId);
      await audit(db, request.user.sub, "driver", driverId, "invite");
      return result;
    });
    response.json(invite);
  }));
}
