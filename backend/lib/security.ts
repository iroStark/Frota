// Primitivas de segurança só com node:crypto (sem dependências nativas).
import { createHash, createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number, options: object) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 32;

/** Hash de password/PIN no formato scrypt$N$r$p$salt$hash (base64url). */
export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(secret, salt, KEY_LENGTH, SCRYPT);
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64url"), hash.toString("base64url")].join("$");
}

export async function verifySecret(secret: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = await scryptAsync(secret, Buffer.from(salt, "base64url"), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Código numérico (ex.: ativação da conta do motorista). */
export function numericCode(length = 6): string {
  return Array.from({ length }, () => randomInt(0, 10)).join("");
}

// --- JWT HS256 mínimo -------------------------------------------------------------------------

export type AccessClaims = {
  sub: string;
  role: "admin" | "gestor" | "motorista";
  driverId: string | null;
  name: string;
};

function b64(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function signJwt(claims: AccessClaims, secret: string, ttlSeconds: number, nowMs = Date.now()): string {
  const iat = Math.floor(nowMs / 1000);
  const body = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ ...claims, iat, exp: iat + ttlSeconds })}`;
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifyJwt(token: string, secret: string, nowMs = Date.now()): AccessClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const expected = createHmac("sha256", secret).update(`${parts[0]}.${parts[1]}`).digest();
  const given = Buffer.from(parts[2], "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    if (header.alg !== "HS256") return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    if (typeof payload.exp !== "number" || payload.exp * 1000 <= nowMs) return null;
    return { sub: payload.sub, role: payload.role, driverId: payload.driverId ?? null, name: payload.name };
  } catch {
    return null;
  }
}
