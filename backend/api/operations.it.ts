// Fluxo completo da operação através da API v1 (base própria, ver test/isolated-db.ts).
import "../test/isolated-db.ts";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import express from "express";
import { closePool, migrate, pool } from "../db.js";
import { calculateWeeklyCharge } from "../domain/charges.ts";
import { addDays, localDateOf, weekStartOf } from "../domain/time.ts";
import { createStaffUser } from "../services/auth.ts";
import { createV1Router, runBillingJobs } from "./v1.ts";

let base = "";
let server: ReturnType<express.Express["listen"]>;
const now = new Date();
const currentWeek = weekStartOf(localDateOf(now.getTime(), 60));
const W1 = addDays(currentWeek, -14);
const W2 = addDays(currentWeek, -7);
const at = (day: string, time: string) => `${day}T${time}:00+01:00`;

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");

async function call(method: string, path: string, body?: unknown, token?: string) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : null };
}

async function uploadFile(token: string, bytes: Buffer, type: string, name = "comprovativo.png") {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type }), name);
  form.append("category", "teste");
  const response = await fetch(`${base}/files`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
  return { status: response.status, data: await response.json() };
}

async function weekly(driverId: string) {
  const rows = (await pool.query(
    `SELECT period_start, amount, status, calculation FROM charges
     WHERE driver_id = $1 AND kind = 'semanal' AND status <> 'anulada' ORDER BY period_start`,
    [driverId],
  )).rows;
  return Object.fromEntries(rows.map((row) => [row.period_start, row]));
}

before(async () => {
  await migrate({ log: () => {} });
  await createStaffUser(pool, { name: "Admin", email: "admin@ops.test", role: "admin", password: "senha-forte-123" });
  const app = express();
  app.use("/api/v1", createV1Router());
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
});

after(async () => {
  server?.close();
  await closePool();
});

describe("operação completa", () => {
  const t: Record<string, string> = {};
  const ids: Record<string, string> = {};

  it("admin cria um gestor e o gestor entra", async () => {
    t.admin = (await call("POST", "/auth/login", { login: "admin@ops.test", password: "senha-forte-123" })).data.accessToken;
    const created = await call("POST", "/users", { name: "Gestora", email: "gestora@ops.test", role: "gestor", password: "outra-senha-456" }, t.admin);
    assert.equal(created.status, 201);
    t.gestor = (await call("POST", "/auth/login", { login: "gestora@ops.test", password: "outra-senha-456" })).data.accessToken;
    assert.ok(t.gestor);
    assert.equal((await call("POST", "/users", { name: "X", email: "x@ops.test", role: "admin", password: "senha-forte-123" }, t.gestor)).status, 403);
  });

  it("regista viaturas e motorista; recusa matrícula duplicada", async () => {
    const vehicle = await call("POST", "/vehicles", { brand: "Suzuki", model: "Express", plate: "ld-11-11-aa", year: 2022 }, t.gestor);
    assert.equal(vehicle.status, 201);
    assert.equal(vehicle.data.plate, "LD-11-11-AA");
    assert.equal(vehicle.data.status, "disponivel");
    ids.vehicle = vehicle.data.id;
    assert.equal((await call("POST", "/vehicles", { brand: "Toyota", model: "Hiace", plate: "LD-11-11-AA" }, t.gestor)).status, 409);
    ids.v2 = (await call("POST", "/vehicles", { brand: "Toyota", model: "Hiace", plate: "LD-22-22-BB" }, t.gestor)).data.id;
    ids.v3 = (await call("POST", "/vehicles", { brand: "Suzuki", model: "Every", plate: "LD-33-33-CC" }, t.gestor)).data.id;
    const driver = await call("POST", "/drivers", {
      name: "João Manuel", phone: "923 111 222", deposit: 50000,
      contacts: [{ name: "Ana", relation: "esposa", phone: "923999888" }],
    }, t.gestor);
    assert.equal(driver.status, 201);
    assert.equal(driver.data.phone, "+244923111222");
    ids.driver = driver.data.id;
    const detail = await call("GET", `/drivers/${ids.driver}`, undefined, t.gestor);
    assert.equal(detail.data.contacts.length, 1);
  });

  it("aceita ficheiros válidos e recusa conteúdo falso", async () => {
    const ok = await uploadFile(t.gestor, PNG, "image/png", "livrete.png");
    assert.equal(ok.status, 201);
    ids.staffFile = ok.data.id;
    const fake = await uploadFile(t.gestor, Buffer.from("nao sou png"), "image/png");
    assert.equal(fake.status, 415);
    const download = await fetch(`${base}/files/${ids.staffFile}`, { headers: { Authorization: `Bearer ${t.gestor}` } });
    assert.equal(download.status, 200);
    assert.equal(download.headers.get("content-type"), "image/png");
  });

  it("documento expirado aparece nos alertas", async () => {
    const yesterday = addDays(localDateOf(now.getTime(), 60), -1);
    const doc = await call("POST", "/documents", { ownerType: "driver", ownerId: ids.driver, type: "carta_conducao", validUntil: yesterday }, t.gestor);
    assert.equal(doc.status, 201);
    const alerts = await call("GET", "/alerts", undefined, t.gestor);
    assert.ok(alerts.data.some((a: any) => a.kind === "documento" && a.severity === "danger" && a.title.includes("João")));
  });

  it("atribui a viatura (uma ativa por viatura e por motorista)", async () => {
    const assignment = await call("POST", "/assignments", {
      vehicleId: ids.vehicle, driverId: ids.driver, startAt: at(addDays(W1, 3), "08:00"), depositReceived: 50000,
      handover: { mileage: 12000, fuelLevel: "meio", checklist: { chaves: true, livrete: true } },
    }, t.gestor);
    assert.equal(assignment.status, 201);
    ids.assignment = assignment.data.id;
    assert.equal((await call("GET", `/vehicles/${ids.vehicle}`, undefined, t.gestor)).data.status, "em_servico");
    const again = await call("POST", "/assignments", { vehicleId: ids.v2, driverId: ids.driver, startAt: now.toISOString() }, t.gestor);
    assert.equal(again.status, 409);
    assert.equal(again.data.code, "motorista_ocupado");
    assert.equal((await call("DELETE", `/vehicles/${ids.vehicle}`, undefined, t.gestor)).status, 409);
  });

  it("gera as cobranças por dias (1.ª semana a partir de quinta)", async () => {
    await runBillingJobs(now);
    const charges = await weekly(ids.driver);
    assert.equal(charges[W1].amount, 86667);
    assert.equal(charges[W2].amount, 130000);
    const penalties = (await pool.query("SELECT amount FROM charges WHERE driver_id = $1 AND kind = 'penalidade_atraso' AND period_start = $2", [ids.driver, W1])).rows;
    assert.equal(penalties[0].amount, 15000); // venceu há mais de 72h
    const dashboard = await call("GET", "/dashboard", undefined, t.gestor);
    assert.ok(dashboard.data.alerts.some((a: any) => a.kind === "atraso_72h"));
  });

  it("ocorrência do gestor desconta os dias parados e é recalculada ao cancelar", async () => {
    const incident = await call("POST", "/incidents", {
      type: "avaria", vehicleId: ids.vehicle, startAt: at(addDays(W2, 2), "06:00"), endAt: at(addDays(W2, 3), "23:00"),
    }, t.gestor);
    assert.equal(incident.status, 201);
    assert.equal(incident.data.driver_id, ids.driver); // motorista deduzido da atribuição
    assert.equal(incident.data.status, "resolvida");
    ids.avaria = incident.data.id;
    assert.equal((await weekly(ids.driver))[W2].amount, 86667);
    assert.deepEqual((await weekly(ids.driver))[W2].calculation.stoppedDays, [addDays(W2, 2), addDays(W2, 3)]);
  });

  it("motorista ativa a conta, envia comprovativo e o gestor confirma", async () => {
    const invite = await call("POST", `/drivers/${ids.driver}/invite`, {}, t.gestor);
    const session = await call("POST", "/auth/activate", { phone: "923111222", code: invite.data.code, pin: "246810" });
    t.driver = session.data.accessToken;
    const home = await call("GET", "/me/home", undefined, t.driver);
    assert.equal(home.status, 200);
    assert.equal(home.data.vehicle.plate, "LD-11-11-AA");
    assert.ok(home.data.balance > 0);

    const proof = await uploadFile(t.driver, PNG, "image/png");
    assert.equal(proof.status, 201);
    ids.driverFile = proof.data.id;
    const declaration = await call("POST", "/me/payment-declarations", {
      amount: 86667, paidAt: new Date(now.getTime() - 3_600_000).toISOString(), proofFileId: ids.driverFile, clientId: crypto.randomUUID(),
    }, t.driver);
    assert.equal(declaration.status, 201);
    assert.equal(declaration.data.status, "pendente");
    assert.equal((await weekly(ids.driver))[W1].status, "aberta"); // ainda não confirmado

    const pending = await call("GET", "/payment-declarations", undefined, t.gestor);
    assert.ok(pending.data.some((d: any) => d.id === declaration.data.id));
    const confirmed = await call("POST", `/payment-declarations/${declaration.data.id}/confirm`, {}, t.gestor);
    assert.equal(confirmed.status, 200);
    assert.equal((await weekly(ids.driver))[W1].status, "paga");
    assert.equal((await call("POST", `/payment-declarations/${declaration.data.id}/confirm`, {}, t.gestor)).status, 409);
    ids.payment = confirmed.data.payment.id;
  });

  it("ocorrência comunicada pelo motorista só conta depois de validada", async () => {
    const reported = await call("POST", "/incidents", {
      type: "doenca", startAt: at(addDays(W2, 5), "05:00"), endAt: at(addDays(W2, 6), "23:30"), notes: "Febre",
    }, t.driver);
    assert.equal(reported.status, 201);
    assert.equal(reported.data.status, "por_validar");
    assert.equal(reported.data.vehicle_id, ids.vehicle);
    assert.equal((await weekly(ids.driver))[W2].amount, 86667);
    const validated = await call("POST", `/incidents/${reported.data.id}/validate`, {}, t.gestor);
    assert.equal(validated.status, 200);
    assert.equal(validated.data.status, "resolvida");
    assert.equal((await weekly(ids.driver))[W2].amount, 43333); // 2 dias de trabalho em 6
    const cancelled = await call("POST", `/incidents/${ids.avaria}/cancel`, { reason: "Registada por engano" }, t.gestor);
    assert.equal(cancelled.status, 200);
    assert.equal((await weekly(ids.driver))[W2].amount, 86667); // só a doença (sáb+dom)
  });

  it("multa fora de horário gera cobrança com o valor do contrato e é anulada se cancelada", async () => {
    const fine = await call("POST", "/incidents", { type: "fora_horario", vehicleId: ids.vehicle, startAt: at(addDays(W2, 1), "23:30"), endAt: at(addDays(W2, 1), "23:59") }, t.gestor);
    const charge = (await pool.query("SELECT kind, amount, status FROM charges WHERE incident_id = $1", [fine.data.id])).rows[0];
    assert.deepEqual([charge.kind, charge.amount, charge.status], ["multa_fora_horario", 50000, "aberta"]);
    await call("POST", `/incidents/${fine.data.id}/cancel`, { reason: "Autorizado" }, t.gestor);
    assert.equal((await pool.query("SELECT status FROM charges WHERE incident_id = $1", [fine.data.id])).rows[0].status, "anulada");
  });

  it("despesas: única, por viatura e dividir total sem perder kwanzas", async () => {
    const single = await call("POST", "/expenses", { mode: "unica", vehicleIds: [ids.vehicle], amount: 15000, category: "lavagem", spentOn: W2 }, t.gestor);
    assert.equal(single.status, 201);
    const perVehicle = await call("POST", "/expenses", { mode: "por_viatura", vehicleIds: [ids.vehicle, ids.v2, ids.v3], amount: 25000, category: "lavagem", spentOn: W2 }, t.gestor);
    assert.equal(perVehicle.data.batch.total, 75000);
    const split = await call("POST", "/expenses", { mode: "dividir_total", vehicleIds: [ids.vehicle, ids.v2, ids.v3], amount: 100000, category: "seguro", spentOn: W2 }, t.gestor);
    assert.deepEqual(split.data.expenses.map((e: any) => e.amount), [33334, 33333, 33333]);
    assert.equal(split.data.batch.total, 100000);
    assert.equal((await call("POST", "/expenses", { mode: "unica", vehicleIds: [ids.vehicle, ids.v2], amount: 1, category: "outro", spentOn: W2 }, t.gestor)).status, 422);
  });

  it("isolamento: o motorista não acede a dados de gestão nem a ficheiros alheios", async () => {
    assert.equal((await call("GET", "/vehicles", undefined, t.driver)).status, 403);
    assert.equal((await call("GET", "/dashboard", undefined, t.driver)).status, 403);
    assert.equal((await call("GET", "/payment-declarations", undefined, t.driver)).status, 403);
    assert.equal((await call("POST", "/expenses", {}, t.driver)).status, 403);
    assert.equal((await fetch(`${base}/files/${ids.staffFile}`, { headers: { Authorization: `Bearer ${t.driver}` } })).status, 403);
    assert.equal((await fetch(`${base}/files/${ids.driverFile}`, { headers: { Authorization: `Bearer ${t.driver}` } })).status, 200);
    const statement = await call("GET", "/me/statement", undefined, t.driver);
    assert.ok(statement.data.charges.some((c: any) => c.calculation?.stoppedDays?.length === 2));
  });

  it("devolve a viatura: cobra a última semana e usa a caução no acerto", async () => {
    const result = await call("POST", `/assignments/${ids.assignment}/return`, {
      endAt: now.toISOString(), returnInfo: { mileage: 13500, fuelLevel: "reserva" }, applyDeposit: true,
    }, t.gestor);
    assert.equal(result.status, 200);
    const { settlement } = result.data;
    assert.equal(settlement.deposit, 50000);
    assert.ok(settlement.depositApplied > 0);
    assert.equal(settlement.depositApplied + settlement.depositToReturn <= 50000, true);
    const vehicle = await call("GET", `/vehicles/${ids.vehicle}`, undefined, t.gestor);
    assert.equal(vehicle.data.status, "disponivel");
    assert.equal(vehicle.data.mileage, 13500);
    // Última semana cobrada já na devolução, só pelos dias até ao dia da devolução (exclusive).
    const finalWeek = calculateWeeklyCharge(currentWeek, { startAt: at(addDays(W1, 3), "08:00"), endAt: now.toISOString(), weeklyFee: 130000 }, []);
    const charges = await weekly(ids.driver);
    if (finalWeek.coveredDays.length) assert.equal(charges[currentWeek].amount, finalWeek.amount);
    else assert.equal(charges[currentWeek], undefined);
    assert.equal(settlement.depositApplied, Math.min(50000, settlement.depositApplied + settlement.remainingDebt));
    assert.equal((await call("POST", `/assignments/${ids.assignment}/return`, { endAt: now.toISOString() }, t.gestor)).status, 409);
  });

  it("anular um pagamento (só admin) volta a abrir a dívida", async () => {
    assert.equal((await call("POST", `/payments/${ids.payment}/void`, { reason: "Transferência devolvida" }, t.gestor)).status, 403);
    const before = (await call("GET", `/drivers/${ids.driver}/statement`, undefined, t.gestor)).data.totals.balance;
    assert.equal((await call("POST", `/payments/${ids.payment}/void`, { reason: "Transferência devolvida" }, t.admin)).status, 200);
    const afterVoid = (await call("GET", `/drivers/${ids.driver}/statement`, undefined, t.gestor)).data.totals.balance;
    assert.equal(afterVoid - before, 86667);
  });

  it("sincronização incremental respeita o âmbito do perfil", async () => {
    await new Promise((resolve) => setTimeout(resolve, 6000)); // sai da janela de sobreposição (5 s) das alterações anteriores
    const full = await call("GET", "/sync/changes", undefined, t.gestor);
    assert.equal(full.status, 200);
    assert.equal(full.data.changes.vehicles.length, 3);
    assert.ok(full.data.changes.expenses.length >= 7);
    const mine = await call("GET", "/sync/changes", undefined, t.driver);
    assert.equal(mine.data.changes.vehicles.length, 1);
    assert.deepEqual(mine.data.changes.drivers.map((d: any) => d.id), [ids.driver]);
    assert.equal(mine.data.changes.expenses, undefined);
    assert.ok(mine.data.changes.charges.every((c: any) => c.driver_id === ids.driver));
    const quiet = await call("GET", `/sync/changes?since=${encodeURIComponent(full.data.cursor)}`, undefined, t.gestor);
    assert.equal(quiet.data.changes.vehicles.length, 0);
    await call("PATCH", `/vehicles/${ids.v2}`, { color: "Branco" }, t.gestor);
    const delta = await call("GET", `/sync/changes?since=${encodeURIComponent(quiet.data.cursor)}`, undefined, t.gestor);
    assert.deepEqual(delta.data.changes.vehicles.map((v: any) => v.color), ["Branco"]);
  });

  it("regista auditoria das operações", async () => {
    const audit = await pool.query("SELECT DISTINCT entity || ':' || action AS a FROM audit_log");
    const actions = audit.rows.map((row) => row.a);
    for (const expected of ["vehicle:create", "driver:create", "assignment:create", "assignment:return", "incident:validate", "incident:cancel", "payment_declaration:confirm", "payment:void"]) {
      assert.ok(actions.includes(expected), `falta ${expected}`);
    }
  });
});
