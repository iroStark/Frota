import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { effectivePaymentTime, splitTotal } from "./money.ts";

describe("splitTotal", () => {
  it("divide sem perder kwanzas", () => {
    assert.deepEqual(splitTotal(100000, 3), [33334, 33333, 33333]);
    assert.deepEqual(splitTotal(90000, 3), [30000, 30000, 30000]);
    assert.equal(splitTotal(1234567, 7).reduce((a, b) => a + b, 0), 1234567);
  });

  it("recusa valores inválidos", () => {
    assert.throws(() => splitTotal(100, 0));
    assert.throws(() => splitTotal(10.5, 2));
    assert.throws(() => splitTotal(-1, 2));
  });
});

describe("effectivePaymentTime", () => {
  it("comprovativo dentro de 12h: conta a hora do pagamento", () => {
    assert.equal(effectivePaymentTime("2026-10-05T10:00:00Z", "2026-10-05T21:00:00Z"), "2026-10-05T10:00:00.000Z");
  });

  it("comprovativo depois de 12h: conta a hora do envio", () => {
    assert.equal(effectivePaymentTime("2026-10-05T10:00:00Z", "2026-10-06T08:00:00Z"), "2026-10-06T08:00:00.000Z");
  });

  it("data de pagamento no futuro não é aceite: conta o envio", () => {
    assert.equal(effectivePaymentTime("2026-10-07T10:00:00Z", "2026-10-05T10:00:00Z"), "2026-10-05T10:00:00.000Z");
  });
});
