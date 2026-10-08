import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, it } from "node:test";
import { fcmMessage, notices, serviceAccountAssertion } from "./notify.ts";

describe("push FCM", () => {
  it("assina o pedido de token OAuth com a chave da conta de serviço (RS256)", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const account = { project_id: "uhocha", client_email: "push@uhocha.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
    const jwt = serviceAccountAssertion(account, 1_800_000_000);
    const [header, payload, signature] = jwt.split(".");
    assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString()), { alg: "RS256", typ: "JWT" });
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    assert.equal(claims.iss, account.client_email);
    assert.equal(claims.scope, "https://www.googleapis.com/auth/firebase.messaging");
    assert.equal(claims.exp - claims.iat, 3600);
    const valid = createVerify("RSA-SHA256").update(`${header}.${payload}`).verify(publicKey, Buffer.from(signature, "base64url"));
    assert.equal(valid, true);
  });

  it("mensagem com título, texto e ecrã a abrir", () => {
    const message = fcmMessage("token-123", { title: "Olá", body: "Texto", route: "/m/pagamentos" });
    assert.equal(message.message.token, "token-123");
    assert.deepEqual(message.message.notification, { title: "Olá", body: "Texto" });
    assert.deepEqual(message.message.data, { route: "/m/pagamentos" });
  });

  it("textos dos avisos com valores legíveis e chave estável", () => {
    const notice = notices.weeklyCharge({ id: "c1", period_start: "2026-09-28", amount: 86667, due_at: "2026-10-05T11:00:00.000Z" });
    assert.equal(notice.title, "Semana de 28 set.: 86 667 Kz");
    assert.equal(notice.dedupeKey, "charge:c1");
    assert.notEqual(notices.penalty("c1", 5000, "2026-09-28").dedupeKey, notices.penalty("c1", 15000, "2026-09-28").dedupeKey);
  });
});
