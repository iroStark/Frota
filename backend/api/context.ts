// Peças comuns às rotas da API v1.
import type { NextFunction, Request, Response } from "express";
import type pg from "pg";
import { z } from "zod";
import { pool } from "../db.js";
import { type AuthedRequest, HttpError } from "../lib/http.ts";
import { type AccessClaims, verifyJwt } from "../lib/security.ts";
import { jwtSecret } from "../services/auth.ts";

export type Db = pg.PoolClient;

export async function withTransaction<T>(work: (db: Db) => Promise<T>): Promise<T> {
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

export async function withClient<T>(work: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await work(client);
  } finally {
    client.release();
  }
}

export function authenticate(request: Request, _response: Response, next: NextFunction) {
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

export function requireRole(...roles: AccessClaims["role"][]) {
  return (request: Request, _response: Response, next: NextFunction) => {
    const { user } = request as AuthedRequest;
    if (!roles.includes(user.role)) {
      next(new HttpError(403, "sem_permissao", "Sem permissão para esta operação."));
      return;
    }
    next();
  };
}

export const staff = requireRole("admin", "gestor");
export const driverOnly = requireRole("motorista");

/** Motorista só pode ver o que é seu; gestor/admin veem tudo. */
export function assertDriverAccess(user: AccessClaims, driverId: string | null) {
  if (user.role === "motorista" && user.driverId !== driverId) {
    throw new HttpError(403, "sem_permissao", "Sem permissão para esta operação.");
  }
}

export function notFound(what: string): HttpError {
  return new HttpError(404, "nao_encontrado", `${what} não encontrado(a).`);
}

export async function audit(db: Db | pg.Pool, userId: string | null, entity: string, entityId: string, action: string, diff?: unknown) {
  await db.query(
    "INSERT INTO audit_log (user_id, entity, entity_id, action, diff) VALUES ($1, $2, $3, $4, $5)",
    [userId, entity, entityId, action, diff === undefined ? null : JSON.stringify(diff)],
  );
}

/** UPDATE parcial a partir de um objeto já validado (chaves = colunas). Devolve a linha atualizada. */
export async function updateColumns(db: Db, table: string, id: string, values: Record<string, unknown>, extraWhere = "") {
  const columns = Object.keys(values).filter((key) => values[key] !== undefined);
  if (!columns.length) {
    const current = await db.query(`SELECT * FROM ${table} WHERE id = $1 ${extraWhere}`, [id]);
    return current.rows[0];
  }
  const sets = columns.map((column, index) => `${column} = $${index + 2}`);
  const result = await db.query(
    `UPDATE ${table} SET ${sets.join(", ")} WHERE id = $1 ${extraWhere} RETURNING *`,
    [id, ...columns.map((column) => {
      const value = values[column];
      return value !== null && typeof value === "object" && !(value instanceof Date) ? JSON.stringify(value) : value;
    })],
  );
  return result.rows[0];
}

export const uuid = z.uuid();
export const isoDateTime = z.iso.datetime({ offset: true });
export const isoDate = z.iso.date();
export const kz = z.number().int().nonnegative();
export const optionalText = (max = 500) => z.string().trim().max(max).nullish().transform((value) => value || null);
