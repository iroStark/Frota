// Testes de integração da API v1 contra Postgres real.
//   npm run test:integration   (cada ficheiro cria a sua base uhocha_it_* do zero)
import "../test/isolated-db.ts";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import express from "express";
import { closePool, migrate, pool } from "../db.js";
import { billableWeeks } from "../domain/charges.ts";
import { createStaffUser } from "../services/auth.ts";
import { createV1Router, runBillingJobs } from "./v1.ts";

let base = "";
let server: ReturnType<express.Express["listen"]>;
const ids: Record<string, string> = {};
const now = new Date();
const assignmentStart = new Date(now.getTime() - 20 * 86_400_000);

async function call(method: string, path: string, body?: unknown, token?: string) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

before(async () => {
  await migrate({ log: () => {} });
  await createStaffUser(pool, { name: "Admin", email: "admin@uhocha.test", role: "admin", password: "senha-forte-123" });
  const insert = async (sql: string, params: unknown[]) => (await pool.query(sql, params)).rows[0].id as string;
  ids.driver = await insert("INSERT INTO drivers (name, phone) VALUES ('João Manuel', '923000001') RETURNING id", []);
  ids.other = await insert("INSERT INTO drivers (name, phone) VALUES ('Pedro Afonso', '923000002') RETURNING id", []);
  ids.vehicle = await insert("INSERT INTO vehicles (brand, model, plate, status) VALUES ('Suzuki', 'Express', 'LD-11-11-AA', 'em_servico') RETURNING id", []);
  ids.assignment = await insert(
    "INSERT INTO assignments (vehicle_id, driver_id, start_at, weekly_fee) VALUES ($1, $2, $3, 130000) RETURNING id",
    [ids.vehicle, ids.driver, assignmentStart],
  );
  const app = express();
  app.use("/api/v1", createV1Router());
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
});

after(async () => {
  server?.close();
  await closePool();
});

describe("API v1", () => {
  let adminToken = "";
  let driverSession: { accessToken: string; refreshToken: string } = { accessToken: "", refreshToken: "" };

  it("rejeita pedidos sem sessão e palavra-passe errada", async () => {
    assert.equal((await call("GET", "/me")).status, 401);
    assert.equal((await call("POST", "/auth/login", { login: "admin@uhocha.test", password: "errada!!" })).status, 401);
  });

  it("autentica a equipa e devolve o perfil", async () => {
    const result = await call("POST", "/auth/login", { login: "ADMIN@uhocha.test", password: "senha-forte-123" });
    assert.equal(result.status, 200);
    assert.equal(result.data.user.role, "admin");
    adminToken = result.data.accessToken;
    const me = await call("GET", "/me", undefined, adminToken);
    assert.equal(me.data.email, "admin@uhocha.test");
  });

  it("gera as cobranças semanais em falta uma única vez", async () => {
    const expected = billableWeeks({ startAt: assignmentStart.toISOString(), weeklyFee: 130000 }, now.toISOString()).length;
    const first = await runBillingJobs(now);
    assert.equal(first.chargesCreated, expected);
    const second = await runBillingJobs(now);
    assert.equal(second.chargesCreated, 0);
    const charges = await call("GET", `/charges?driverId=${ids.driver}`, undefined, adminToken);
    assert.equal(charges.data.filter((c: any) => c.kind === "semanal").length, expected);
    assert.ok(expected >= 2);
  });

  it("aplica penalidades às semanas vencidas e não pagas", async () => {
    const charges = await call("GET", `/charges?driverId=${ids.driver}`, undefined, adminToken);
    const overdue = charges.data.filter((c: any) => c.kind === "semanal" && new Date(c.due_at).getTime() < now.getTime());
    const penalties = charges.data.filter((c: any) => c.kind === "penalidade_atraso");
    assert.equal(penalties.length, overdue.length);
    assert.ok(penalties.every((p: any) => [5000, 15000].includes(p.amount)));
  });

  it("regista pagamento, aloca à semana mais antiga e é idempotente por clientId", async () => {
    const clientId = crypto.randomUUID();
    const body = { driverId: ids.driver, amount: 130000, receivedAt: now.toISOString(), method: "numerario", clientId };
    const first = await call("POST", "/payments", body, adminToken);
    assert.equal(first.status, 201);
    const weekly = (await pool.query(
      "SELECT id, amount, status FROM charges WHERE driver_id = $1 AND kind = 'semanal' ORDER BY due_at", [ids.driver],
    )).rows;
    // A 1.ª semana é proporcional (< 130 000): fica paga e o resto passa para a semana seguinte.
    assert.equal(first.data.allocations[0].charge_id, weekly[0].id);
    assert.equal(first.data.allocations[0].amount, weekly[0].amount);
    assert.equal(weekly[0].status, "paga");
    assert.equal(first.data.allocations.reduce((sum: number, a: any) => sum + a.amount, 0), 130000);
    if (weekly[0].amount < 130000) {
      assert.equal(first.data.allocations[1].charge_id, weekly[1].id);
      assert.equal(weekly[1].status, "parcial");
    }
    const replay = await call("POST", "/payments", body, adminToken);
    assert.equal(replay.status, 200);
    assert.equal(replay.data.replayed, true);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM payments")).rows[0].n, 1);
  });

  it("valida o corpo dos pedidos", async () => {
    const result = await call("POST", "/payments", { driverId: "x", amount: -1 }, adminToken);
    assert.equal(result.status, 422);
    assert.ok(result.data.details);
  });

  it("convida e ativa o motorista com código de 6 dígitos + PIN", async () => {
    const invite = await call("POST", `/drivers/${ids.driver}/invite`, {}, adminToken);
    assert.equal(invite.status, 200);
    assert.match(invite.data.code, /^\d{6}$/);
    const wrong = invite.data.code === "000000" ? "111111" : "000000";
    assert.equal((await call("POST", "/auth/activate", { phone: "923 000 001", code: wrong, pin: "123456" })).status, 401);
    const ok = await call("POST", "/auth/activate", { phone: "923 000 001", code: invite.data.code, pin: "123456" });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.user.role, "motorista");
    driverSession = ok.data;
    assert.equal((await call("POST", "/auth/activate", { phone: "923000001", code: invite.data.code, pin: "654321" })).status, 401);
  });

  it("o motorista vê só o seu extrato", async () => {
    const own = await call("GET", "/me/statement", undefined, driverSession.accessToken);
    assert.equal(own.status, 200);
    assert.equal(own.data.driver.id, ids.driver);
    assert.equal(own.data.totals.paid, 130000);
    assert.ok(own.data.charges[0].calculation === null || own.data.charges.some((c: any) => c.calculation?.chargedDays >= 0));
    assert.equal((await call("GET", `/drivers/${ids.other}/statement`, undefined, driverSession.accessToken)).status, 403);
    assert.equal((await call("GET", "/charges", undefined, driverSession.accessToken)).status, 403);
    assert.equal((await call("POST", "/payments", {}, driverSession.accessToken)).status, 403);
  });

  it("entra com PIN depois da ativação", async () => {
    const result = await call("POST", "/auth/login", { login: "+244923000001", password: "123456" });
    assert.equal(result.status, 200);
  });

  it("roda o refresh token e revoga tudo se um token antigo for reutilizado", async () => {
    const rotated = await call("POST", "/auth/refresh", { refreshToken: driverSession.refreshToken });
    assert.equal(rotated.status, 200);
    assert.notEqual(rotated.data.refreshToken, driverSession.refreshToken);
    const reuse = await call("POST", "/auth/refresh", { refreshToken: driverSession.refreshToken });
    assert.equal(reuse.status, 401);
    const afterTheft = await call("POST", "/auth/refresh", { refreshToken: rotated.data.refreshToken });
    assert.equal(afterTheft.status, 401);
  });

  it("bloqueia a conta após 5 tentativas falhadas", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await call("POST", "/auth/login", { login: "admin@uhocha.test", password: "errada!!" });
    }
    const locked = await call("POST", "/auth/login", { login: "admin@uhocha.test", password: "senha-forte-123" });
    assert.equal(locked.status, 429);
  });
});
