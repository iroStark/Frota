import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planLegacyImport } from "./legacy.ts";

const NOW = "2026-10-07T09:00:00.000Z"; // quarta; semanas cobráveis terminam a 04-10

const legacy = {
  version: 1,
  settings: { weeklyFee: 130000, deliveryHour: "12:00", penaltyLate24: 5000, penaltyLate72: 15000 },
  vehicles: [
    { id: "v1", brand: "Suzuki", model: "Express", plate: "LD-11-11-AA", status: "ativo", driverId: "d1" },
    { id: "v2", brand: "Toyota", model: "Hiace", plate: "HL-22-22-BB", status: "ativo", driverId: "d2", assignedAt: "2026-09-24T09:00:00+01:00" },
    { id: "v3", brand: "Suzuki", model: "Every", plate: "HL-33-33-CC", status: "ativo", driverId: "d3" },
    { id: "v4", brand: "Suzuki", model: "Every", plate: "ld-11-11-aa", status: "imobilizado", driverId: "" },
  ],
  drivers: [
    { id: "d1", name: "João Manuel", phone: "+244923000001", biValid: "2026-10-17", bi: "000111LA", contacts: [{ name: "Ana", relation: "esposa", phone: "+244923999999" }] },
    { id: "d2", name: "Pedro Afonso", phone: "+244923000002" },
    { id: "d3", name: "Carlos Neto", phone: "+244923000003" },
  ],
  assignments: [
    { id: "a1", vehicleId: "v1", driverId: "d1", startAt: "2026-09-15T08:00:00+01:00", status: "ativo", weeklyFee: 130000 },
    { id: "a3", vehicleId: "v3", driverId: "d3", startAt: "2026-09-01T08:00:00+01:00", status: "ativo", weeklyFee: 130000 },
  ],
  payments: [
    { id: "p1", driverId: "d1", vehicleId: "v1", amount: 130000, penaltyPaid: 0, dueAt: "2026-09-21T11:00:00Z", paidAt: "2026-09-21T10:00:00Z" },
    { id: "p2", driverId: "d1", vehicleId: "v1", amount: 130000, penaltyPaid: 5000, dueAt: "2026-09-28T11:00:00Z", paidAt: "2026-09-28T15:00:00Z" },
    { id: "p3", driverId: "d2", vehicleId: "v2", isExempt: true, exemptReason: "doenca", amount: 0, dueAt: "2026-10-05T11:00:00Z", paidAt: "2026-10-05T09:00:00Z" },
    { id: "p4", driverId: "d3", vehicleId: "v3", amount: 700000, penaltyPaid: 0, dueAt: "2026-10-05T11:00:00Z", paidAt: "2026-10-05T10:00:00Z" },
    { id: "p5", driverId: "ghost", vehicleId: "v1", amount: 1000, dueAt: "2026-10-05T11:00:00Z", paidAt: "2026-10-05T10:00:00Z" },
  ],
  events: [
    { id: "e1", type: "doenca", vehicleId: "v3", driverId: "d3", startDate: "2026-09-30T06:00:00+01:00", endDate: "2026-10-01T23:00:00+01:00", status: "resolvido", exemptFromFee: true },
  ],
  expenses: [
    { id: "x1", vehicleId: "v1", batchId: "b1", category: "lavagem", responsible: "proprietaria", amount: 25000, date: "2026-10-01" },
    { id: "x2", vehicleId: "v3", batchId: "b1", category: "lavagem", responsible: "proprietaria", amount: 25000, date: "2026-10-01" },
  ],
  documents: [
    { id: "doc1", scope: "driver", driverId: "d1", name: "Carta de Condução", expiresAt: "2026-10-12" },
  ],
};

const plan = planLegacyImport(legacy, { now: NOW });
const driver = (name: string) => plan.report.drivers.find((row) => row.name === name)!;
const driverRow = (name: string) => plan.rows.drivers.find((row) => row.name === name)!;
const weekly = (name: string) => plan.rows.charges
  .filter((row) => row.kind === "semanal" && row.driver_id === driverRow(name).id)
  .sort((a, b) => String(a.period_start).localeCompare(String(b.period_start)));

describe("planLegacyImport", () => {
  it("reconstrói as semanas cobráveis e aloca os pagamentos às mais antigas", () => {
    const joao = driver("João Manuel");
    assert.equal(joao.weeksCharged, 3); // 14-09, 21-09, 28-09
    assert.deepEqual(weekly("João Manuel").map((c) => [c.period_start, c.amount, c.status]), [
      ["2026-09-14", 130000, "paga"],
      ["2026-09-21", 130000, "paga"],
      ["2026-09-28", 130000, "aberta"],
    ]);
    assert.equal(joao.totalPaid, 265000);
    assert.equal(joao.balance, 130000);
    assert.deepEqual(joao.openWeeks, ["2026-09-28"]);
  });

  it("cria a penalidade só no valor pago e ligada à semana desse vencimento", () => {
    const penalty = plan.rows.charges.find((row) => row.kind === "penalidade_atraso")!;
    assert.equal(penalty.amount, 5000);
    assert.equal(penalty.status, "paga");
    const week = weekly("João Manuel").find((c) => c.period_start === "2026-09-21")!;
    assert.equal(penalty.related_charge_id, week.id);
  });

  it("cria atribuição para viatura com motorista definido e cobra a 1.ª semana por dias", () => {
    const synthetic = plan.rows.assignments.find((row) => row.synthetic && row.driver_id === driverRow("Pedro Afonso").id);
    assert.ok(synthetic);
    assert.deepEqual(weekly("Pedro Afonso").map((c) => [c.period_start, c.amount, c.status]), [
      ["2026-09-21", 86667, "aberta"], // qui–dom
      ["2026-09-28", 0, "isenta"], // isenção de semana antiga (vencimento 05-10 → semana 28-09)
    ]);
    assert.ok(plan.report.warnings.some((w) => w.includes("HL-22-22-BB")));
  });

  it("desconta dias parados das ocorrências e regista pagamento em excesso como crédito", () => {
    const carlos = weekly("Carlos Neto");
    assert.equal(carlos.length, 5);
    assert.equal(carlos.at(-1)!.amount, 86667); // doença qua+qui
    assert.deepEqual((carlos.at(-1)!.calculation as any).stoppedDays, ["2026-09-30", "2026-10-01"]);
    assert.equal(driver("Carlos Neto").balance, 606667 - 700000);
    assert.ok(plan.report.warnings.some((w) => w.includes("93333 Kz acima")));
  });

  it("deteta matrícula duplicada e pagamentos órfãos", () => {
    assert.ok(plan.report.warnings.some((w) => w.includes("Matrícula duplicada")));
    assert.ok(plan.report.warnings.some((w) => w.includes("p5")));
    assert.equal(plan.rows.payments.length, 3);
  });

  it("importa documentos pessoais, contactos, despesas em lote e estado das viaturas", () => {
    const docs = plan.rows.documents.filter((row) => row.owner_id === driverRow("João Manuel").id).map((row) => row.type).sort();
    assert.deepEqual(docs, ["bilhete_identidade", "carta_conducao"]);
    assert.equal(plan.rows.driver_contacts.length, 1);
    assert.equal(plan.rows.expense_batches.length, 1);
    assert.equal(plan.rows.expense_batches[0].total, 50000);
    const status = Object.fromEntries(plan.rows.vehicles.map((row) => [row.legacy_id, row.status]));
    assert.deepEqual(status, { v1: "em_servico", v2: "em_servico", v3: "em_servico", v4: "imobilizada" });
  });

  it("calcula penalidades que nunca foram cobradas para o relatório", () => {
    // Semana 28-09 do João em dívida desde 05-10 12:00 → > 24h em 07-10 → 15 000 Kz.
    assert.equal(driver("João Manuel").uncollectedPenalties, 15000);
  });
});
