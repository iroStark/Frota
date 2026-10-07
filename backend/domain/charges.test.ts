import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_RULES,
  allocatePayment,
  billableWeeks,
  calculateWeeklyCharge,
  chargeStatus,
  latePenalty,
  recalculateCharge,
} from "./charges.ts";

// Semana de referência: segunda 28-09-2026 a domingo 04-10-2026; entrega segunda 05-10 às 12:00 (11:00Z).
const WEEK = "2026-09-28";
const FEE = 130000;
const longAgo = { startAt: "2026-01-01T08:00:00+01:00", weeklyFee: FEE };
const local = (value: string) => `${value}+01:00`;

describe("calculateWeeklyCharge", () => {
  it("cobra o valor contratual exato numa semana completa e vence na segunda seguinte às 12:00", () => {
    const charge = calculateWeeklyCharge(WEEK, longAgo, []);
    assert.equal(charge.amount, FEE);
    assert.equal(charge.workingDays, 6);
    assert.equal(charge.chargedDays, 6);
    assert.equal(charge.dailyRate, 21667);
    assert.equal(charge.periodEnd, "2026-10-04");
    assert.equal(charge.dueAt, "2026-10-05T11:00:00.000Z");
  });

  it("segunda-feira não conta (não circula)", () => {
    const charge = calculateWeeklyCharge(WEEK, longAgo, []);
    assert.ok(!charge.coveredDays.includes("2026-09-28"));
  });

  it("atribuição iniciada a uma quinta cobra 4 dias (qui–dom)", () => {
    const charge = calculateWeeklyCharge(WEEK, { startAt: local("2026-10-01T10:00:00"), weeklyFee: FEE }, []);
    assert.deepEqual(charge.coveredDays, ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    assert.equal(charge.amount, 86667);
  });

  it("devolução a um sábado: o dia da devolução não é cobrado (ter–sex = 4 dias)", () => {
    const charge = calculateWeeklyCharge(WEEK, { ...longAgo, endAt: local("2026-10-03T09:00:00") }, []);
    assert.deepEqual(charge.coveredDays, ["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
    assert.equal(charge.amount, 86667);
  });

  it("2 dias parados a meio da semana descontam 2 dias", () => {
    const stop = { id: "oficina", startAt: local("2026-09-30T08:00:00"), endAt: local("2026-10-01T23:00:00") };
    const charge = calculateWeeklyCharge(WEEK, longAgo, [stop]);
    assert.deepEqual(charge.stoppedDays, ["2026-09-30", "2026-10-01"]);
    assert.equal(charge.chargedDays, 4);
    assert.equal(charge.amount, 86667);
    assert.deepEqual(charge.stopIds, ["oficina"]);
  });

  it("paragem curta (< 4h no horário de circulação) não conta como dia parado", () => {
    const stop = { startAt: local("2026-09-30T18:00:00"), endAt: local("2026-09-30T20:00:00") };
    assert.equal(calculateWeeklyCharge(WEEK, longAgo, [stop]).amount, FEE);
  });

  it("paragem de madrugada fora do horário de circulação não conta", () => {
    const stop = { startAt: local("2026-09-30T20:00:00"), endAt: local("2026-10-01T04:59:00") };
    assert.equal(calculateWeeklyCharge(WEEK, longAgo, [stop]).amount, FEE);
  });

  it("paragem ainda sem fim isenta até ao fim da semana", () => {
    const stop = { startAt: local("2026-10-02T10:00:00"), endAt: null };
    const charge = calculateWeeklyCharge(WEEK, longAgo, [stop]);
    assert.deepEqual(charge.stoppedDays, ["2026-10-02", "2026-10-03", "2026-10-04"]);
    assert.equal(charge.amount, 65000);
  });

  it("paragem só à segunda-feira não altera o valor", () => {
    const stop = { startAt: local("2026-09-28T05:00:00"), endAt: local("2026-09-28T23:00:00") };
    assert.equal(calculateWeeklyCharge(WEEK, longAgo, [stop]).amount, FEE);
  });

  it("semana inteira parada dá 0 e fica isenta", () => {
    const stop = { startAt: local("2026-09-27T00:00:00"), endAt: local("2026-10-06T00:00:00") };
    const charge = calculateWeeklyCharge(WEEK, longAgo, [stop]);
    assert.equal(charge.amount, 0);
    assert.equal(chargeStatus(charge.amount, 0), "isenta");
  });

  it("início + paragem combinados", () => {
    const assignment = { startAt: local("2026-09-30T09:00:00"), weeklyFee: FEE }; // qua–dom = 5 dias
    const stop = { startAt: local("2026-10-03T05:00:00"), endAt: local("2026-10-03T23:00:00") }; // sábado
    const charge = calculateWeeklyCharge(WEEK, assignment, [stop]);
    assert.equal(charge.chargedDays, 4);
    assert.equal(charge.amount, 86667);
  });

  it("usa a taxa semanal acordada na atribuição", () => {
    assert.equal(calculateWeeklyCharge(WEEK, { ...longAgo, weeklyFee: 120000 }, []).amount, 120000);
    assert.equal(
      calculateWeeklyCharge(WEEK, { startAt: local("2026-10-01T10:00:00"), weeklyFee: 120000 }, []).amount,
      80000,
    );
  });

  it("respeita o fuso de Luanda: segunda 00:30 local é segunda, não domingo", () => {
    const charge = calculateWeeklyCharge(WEEK, { startAt: "2026-09-27T23:30:00Z", weeklyFee: FEE }, []);
    assert.equal(charge.amount, FEE); // começou na segunda local → semana completa
    const sunday = calculateWeeklyCharge(WEEK, { startAt: "2026-10-03T23:30:00Z", weeklyFee: FEE }, []);
    assert.deepEqual(sunday.coveredDays, ["2026-10-04"]); // domingo 00:30 local
  });

  it("aceita um divisor de 7 dias se o contrato mudar", () => {
    const rules = { ...DEFAULT_RULES, workingWeekdays: [1, 2, 3, 4, 5, 6, 7], operatingHours: { ...DEFAULT_RULES.operatingHours, 1: ["05:00", "22:00"] as [string, string] } };
    const charge = calculateWeeklyCharge(WEEK, { startAt: local("2026-10-01T10:00:00"), weeklyFee: FEE }, [], rules);
    assert.equal(charge.workingDays, 7);
    assert.equal(charge.amount, 74286);
  });

  it("recusa semanas que não começam à segunda", () => {
    assert.throws(() => calculateWeeklyCharge("2026-09-29", longAgo, []));
  });
});

describe("billableWeeks", () => {
  it("só cobra semanas já terminadas", () => {
    const weeks = billableWeeks({ startAt: local("2026-09-17T10:00:00"), weeklyFee: FEE }, local("2026-10-07T09:00:00"));
    assert.deepEqual(weeks, ["2026-09-14", "2026-09-21", "2026-09-28"]);
  });

  it("na segunda de manhã a semana anterior já é cobrável", () => {
    const weeks = billableWeeks({ startAt: local("2026-09-29T10:00:00"), weeklyFee: FEE }, local("2026-10-05T00:01:00"));
    assert.deepEqual(weeks, ["2026-09-28"]);
  });

  it("pára na semana da devolução", () => {
    const assignment = { startAt: local("2026-09-17T10:00:00"), endAt: local("2026-09-24T18:00:00"), weeklyFee: FEE };
    assert.deepEqual(billableWeeks(assignment, local("2026-10-20T09:00:00")), ["2026-09-14", "2026-09-21"]);
  });

  it("devolução à meia-noite de segunda não gera semana extra", () => {
    const assignment = { startAt: local("2026-09-17T10:00:00"), endAt: local("2026-09-28T00:00:00"), weeklyFee: FEE };
    assert.deepEqual(billableWeeks(assignment, local("2026-10-20T09:00:00")), ["2026-09-14", "2026-09-21"]);
  });
});

describe("latePenalty", () => {
  const charge = { amount: FEE, dueAt: "2026-10-05T11:00:00.000Z" };

  it("sem penalidade se pago até à hora limite", () => {
    assert.equal(latePenalty(charge, "2026-10-05T10:59:00Z", "2026-10-10T00:00:00Z").amount, 0);
  });

  it("até 24h: 5 000 Kz", () => {
    const penalty = latePenalty(charge, "2026-10-05T16:00:00Z", "2026-10-10T00:00:00Z");
    assert.equal(penalty.tier, "ate_24h");
    assert.equal(penalty.amount, 5000);
  });

  it("entre 24h e 72h: 15 000 Kz", () => {
    assert.equal(latePenalty(charge, "2026-10-06T17:00:00Z", "2026-10-10T00:00:00Z").amount, 15000);
  });

  it("mais de 72h: 15 000 Kz e alerta (sem rescisão automática)", () => {
    const penalty = latePenalty(charge, "2026-10-08T12:00:00Z", "2026-10-10T00:00:00Z");
    assert.equal(penalty.amount, 15000);
    assert.equal(penalty.breachAlert, true);
  });

  it("ainda em dívida usa o momento atual", () => {
    assert.equal(latePenalty(charge, null, "2026-10-05T12:00:00Z").tier, "ate_24h");
    assert.equal(latePenalty(charge, null, "2026-10-09T12:00:00Z").breachAlert, true);
  });

  it("cobrança isenta nunca tem penalidade", () => {
    assert.equal(latePenalty({ ...charge, amount: 0 }, null, "2026-11-01T00:00:00Z").amount, 0);
  });
});

describe("allocatePayment", () => {
  const open = [
    { id: "s3", dueAt: "2026-10-05T11:00:00Z", outstanding: 130000 },
    { id: "s1", dueAt: "2026-09-21T11:00:00Z", outstanding: 50000 },
    { id: "s2", dueAt: "2026-09-28T11:00:00Z", outstanding: 130000 },
  ];

  it("paga primeiro as semanas mais antigas", () => {
    const { allocations, credit } = allocatePayment(200000, open);
    assert.deepEqual(allocations, [
      { chargeId: "s1", amount: 50000 },
      { chargeId: "s2", amount: 130000 },
      { chargeId: "s3", amount: 20000 },
    ]);
    assert.equal(credit, 0);
  });

  it("pagamento de 3 semanas em atraso com troco vira crédito", () => {
    const { allocations, credit } = allocatePayment(320000, open);
    assert.equal(allocations.length, 3);
    assert.equal(credit, 10000);
  });

  it("recusa valores não positivos", () => {
    assert.throws(() => allocatePayment(0, open));
  });
});

describe("recalculateCharge", () => {
  it("ocorrência registada depois de a semana estar paga gera crédito", () => {
    const result = recalculateCharge(86667, 130000);
    assert.equal(result.credit, 43333);
    assert.equal(result.status, "paga");
  });

  it("sem pagamento só muda o valor", () => {
    assert.deepEqual(recalculateCharge(86667, 0), { amount: 86667, status: "aberta", credit: 0 });
  });
});
