import type pg from "pg";
import { HttpError } from "../lib/http.ts";
import {
  type AccessClaims,
  hashSecret,
  numericCode,
  randomToken,
  sha256,
  signJwt,
  verifySecret,
} from "../lib/security.ts";

type Db = pg.PoolClient | pg.Pool;

const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_DAYS = 30;
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const ACTIVATION_HOURS = 48;

let devSecret: string | null = null;

export function jwtSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === "production") throw new HttpError(503, "configuracao", "Servidor sem JWT_SECRET configurado.");
  devSecret ??= randomToken();
  return devSecret;
}

/** Normaliza telefones angolanos para +244XXXXXXXXX; devolve o texto original se não reconhecer. */
export function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 9) return `+244${digits}`;
  if (digits.length === 12 && digits.startsWith("244")) return `+${digits}`;
  return value.trim();
}

type UserRow = {
  id: string; name: string; role: AccessClaims["role"]; driver_id: string | null; active: boolean;
  password_hash: string | null; pin_hash: string | null; failed_logins: number; locked_until: Date | null;
};

function claimsOf(user: UserRow): AccessClaims {
  return { sub: user.id, role: user.role, driverId: user.driver_id, name: user.name };
}

async function issueSession(db: Db, user: UserRow, userAgent: string | undefined) {
  const refreshToken = randomToken();
  await db.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent)
     VALUES ($1, $2, now() + make_interval(days => $3), $4)`,
    [user.id, sha256(refreshToken), REFRESH_TTL_DAYS, userAgent?.slice(0, 200) ?? null],
  );
  await db.query("UPDATE users SET last_login_at = now(), failed_logins = 0, locked_until = NULL WHERE id = $1", [user.id]);
  return {
    accessToken: signJwt(claimsOf(user), jwtSecret(), ACCESS_TTL_SECONDS),
    accessTokenExpiresIn: ACCESS_TTL_SECONDS,
    refreshToken,
    user: { id: user.id, name: user.name, role: user.role, driverId: user.driver_id },
  };
}

const INVALID_LOGIN = new HttpError(401, "credenciais_invalidas", "Telefone/email ou palavra-passe incorretos.");

/** Sem transação: o contador de tentativas falhadas tem de ficar gravado mesmo quando o login falha. */
export async function login(db: pg.Pool, loginValue: string, secret: string, userAgent?: string) {
  const login = loginValue.trim().toLowerCase();
  const result = await db.query<UserRow>(
    `SELECT id, name, role, driver_id, active, password_hash, pin_hash, failed_logins, locked_until
     FROM users WHERE lower(email) = $1 OR phone = $2 LIMIT 1`,
    [login, normalizePhone(loginValue)],
  );
  const user = result.rows[0];
  if (!user || !user.active) {
    await hashSecret(secret); // tempo de resposta semelhante a um utilizador existente
    throw INVALID_LOGIN;
  }
  if (user.locked_until && user.locked_until.getTime() > Date.now()) {
    throw new HttpError(429, "bloqueado", `Conta bloqueada temporariamente. Tente após ${LOCK_MINUTES} minutos.`);
  }
  const stored = user.role === "motorista" ? user.pin_hash : user.password_hash;
  if (!(await verifySecret(secret, stored))) {
    await db.query(
      `UPDATE users SET failed_logins = failed_logins + 1,
         locked_until = CASE WHEN failed_logins + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END
       WHERE id = $1`,
      [user.id, MAX_FAILED_LOGINS, LOCK_MINUTES],
    );
    throw INVALID_LOGIN;
  }
  return issueSession(db, user, userAgent);
}

/**
 * Rotação de refresh token. Reutilizar um token já trocado revoga todas as sessões do utilizador.
 * Devolve null quando a sessão é inválida (não lança, para que a revogação seja confirmada).
 */
export async function refresh(db: pg.PoolClient, refreshToken: string, userAgent?: string) {
  const result = await db.query(
    `SELECT t.id, t.user_id, t.expires_at, t.revoked_at, u.id AS uid, u.name, u.role, u.driver_id, u.active,
            u.password_hash, u.pin_hash, u.failed_logins, u.locked_until
     FROM refresh_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = $1 FOR UPDATE OF t`,
    [sha256(refreshToken)],
  );
  const row = result.rows[0];
  if (!row) return null;
  if (row.revoked_at) {
    await db.query("UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [row.user_id]);
    return null;
  }
  if (row.expires_at.getTime() <= Date.now() || !row.active) return null;
  const user: UserRow = { ...row, id: row.uid };
  const session = await issueSession(db, user, userAgent);
  await db.query(
    "UPDATE refresh_tokens SET revoked_at = now(), replaced_by = (SELECT id FROM refresh_tokens WHERE token_hash = $2) WHERE id = $1",
    [row.id, sha256(session.refreshToken)],
  );
  return session;
}

export async function logout(db: Db, refreshToken: string) {
  await db.query("UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL", [sha256(refreshToken)]);
}

/** Gestor convida o motorista: cria/atualiza a conta e devolve um código de 6 dígitos válido 48h. */
export async function inviteDriver(db: Db, driverId: string) {
  const driver = await db.query("SELECT id, name, phone FROM drivers WHERE id = $1 AND deleted_at IS NULL", [driverId]);
  if (!driver.rowCount) throw new HttpError(404, "motorista_inexistente", "Motorista não encontrado.");
  const { name, phone } = driver.rows[0];
  if (!phone) throw new HttpError(422, "sem_telefone", "O motorista precisa de telefone para aceder à app.");
  const code = numericCode(6);
  await db.query(
    `INSERT INTO users (name, phone, role, driver_id, activation_code_hash, activation_expires_at, active)
     VALUES ($1, $2, 'motorista', $3, $4, now() + make_interval(hours => $5), true)
     ON CONFLICT (driver_id) WHERE driver_id IS NOT NULL
     DO UPDATE SET activation_code_hash = EXCLUDED.activation_code_hash,
                   activation_expires_at = EXCLUDED.activation_expires_at,
                   phone = EXCLUDED.phone, active = true, failed_logins = 0, locked_until = NULL`,
    [name, normalizePhone(phone), driverId, sha256(code), ACTIVATION_HOURS],
  );
  return { code, expiresInHours: ACTIVATION_HOURS, phone: normalizePhone(phone) };
}

export async function activateDriver(db: Db, phone: string, code: string, pin: string, userAgent?: string) {
  const result = await db.query<UserRow & { activation_code_hash: string | null; activation_expires_at: Date | null }>(
    `SELECT id, name, role, driver_id, active, password_hash, pin_hash, failed_logins, locked_until,
            activation_code_hash, activation_expires_at
     FROM users WHERE phone = $1 AND role = 'motorista'`,
    [normalizePhone(phone)],
  );
  const user = result.rows[0];
  const valid = user?.active && user.activation_code_hash === sha256(code)
    && user.activation_expires_at && user.activation_expires_at.getTime() > Date.now();
  if (!valid) throw new HttpError(401, "codigo_invalido", "Código inválido ou expirado. Peça um novo ao gestor.");
  await db.query(
    "UPDATE users SET pin_hash = $2, activation_code_hash = NULL, activation_expires_at = NULL WHERE id = $1",
    [user.id, await hashSecret(pin)],
  );
  await db.query("UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [user.id]);
  return issueSession(db, user, userAgent);
}

export async function createStaffUser(db: Db, input: { name: string; email?: string; phone?: string; role: "admin" | "gestor"; password: string }) {
  const result = await db.query(
    `INSERT INTO users (name, email, phone, role, password_hash) VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, email, phone, role`,
    [input.name, input.email?.toLowerCase() ?? null, input.phone ? normalizePhone(input.phone) : null, input.role, await hashSecret(input.password)],
  );
  return result.rows[0];
}
