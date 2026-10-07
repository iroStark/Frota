import { createHmac, timingSafeEqual } from "node:crypto";

// Proteção temporária (Fase 0): uma chave de acesso partilhada, trocada por um cookie de sessão
// assinado. Será substituída por utilizadores e perfis na Fase 2.

const COOKIE_NAME = "uhocha_session";
const SESSION_DAYS = 30;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

const accessKey = process.env.APP_ACCESS_KEY || "";
const sessionSecret = process.env.SESSION_SECRET || (accessKey ? `uhocha:${accessKey}` : "");
const isProduction = process.env.NODE_ENV === "production";

export const authMode = accessKey ? "key" : isProduction ? "misconfigured" : "open";

const loginAttempts = new Map();

function sign(value) {
  return createHmac("sha256", sessionSecret).update(value).digest("base64url");
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

function readCookie(request, name) {
  const header = request.headers.cookie || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

function createSessionToken() {
  const expiresAt = Date.now() + SESSION_DAYS * 86400000;
  const payload = `v1.${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

function isValidSessionToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  const payload = `${parts[0]}.${parts[1]}`;
  if (!safeEqual(parts[2], sign(payload))) return false;
  return Number(parts[1]) > Date.now();
}

export function isAuthenticated(request) {
  if (authMode === "open") return true;
  if (authMode === "misconfigured") return false;
  return isValidSessionToken(readCookie(request, COOKIE_NAME));
}

export function requireAuth(request, response, next) {
  if (authMode === "misconfigured") {
    response.status(503).json({ error: "Servidor sem APP_ACCESS_KEY configurada." });
    return;
  }
  if (!isAuthenticated(request)) {
    response.status(401).json({ error: "Sessão inválida ou expirada." });
    return;
  }
  next();
}

function setSessionCookie(request, response, token, maxAgeSeconds) {
  const secure = request.secure ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`,
  );
}

function tooManyAttempts(ip) {
  const now = Date.now();
  if (loginAttempts.size > 1000) {
    for (const [key, value] of loginAttempts) {
      if (now - value.firstAt > LOGIN_WINDOW_MS) loginAttempts.delete(key);
    }
  }
  const entry = loginAttempts.get(ip);
  if (!entry || now - entry.firstAt > LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { firstAt: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > LOGIN_MAX_ATTEMPTS;
}

export function registerAuthRoutes(app) {
  app.get("/api/session", (request, response) => {
    response.json({
      authRequired: authMode !== "open",
      authenticated: isAuthenticated(request),
      configured: authMode !== "misconfigured",
    });
  });

  app.post("/api/session", (request, response) => {
    if (authMode === "open") {
      response.json({ ok: true });
      return;
    }
    if (authMode === "misconfigured") {
      response.status(503).json({ error: "Servidor sem APP_ACCESS_KEY configurada." });
      return;
    }
    if (tooManyAttempts(request.ip)) {
      response.status(429).json({ error: "Demasiadas tentativas. Tente novamente dentro de 15 minutos." });
      return;
    }
    if (!safeEqual(String(request.body?.key || ""), accessKey)) {
      response.status(401).json({ error: "Chave de acesso incorreta." });
      return;
    }
    loginAttempts.delete(request.ip);
    setSessionCookie(request, response, createSessionToken(), SESSION_DAYS * 86400);
    response.json({ ok: true });
  });

  app.delete("/api/session", (request, response) => {
    setSessionCookie(request, response, "", 0);
    response.json({ ok: true });
  });
}
