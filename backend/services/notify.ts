// Avisos dentro da app (tabela notifications) e, se configurado, notificações push (FCM).
import { createSign } from "node:crypto";
import type pg from "pg";
import { addDays, isoWeekday, localDateOf, localTimeToInstant, weekStartOf } from "../domain/time.ts";

type Db = pg.PoolClient | pg.Pool;

export type Notice = {
  kind: string;
  title: string;
  body: string;
  /** Ecrã a abrir na app ao tocar (ex.: "/m/pagamentos"). */
  route?: string;
  /** Igual para o mesmo acontecimento: impede avisos repetidos. */
  dedupeKey?: string;
};

const kz = (value: unknown) => `${new Intl.NumberFormat("pt-PT", { useGrouping: "always" }).format(Number(value)).replace(/\s/g, " ")} Kz`;
const MONTHS = ["jan.", "fev.", "mar.", "abr.", "mai.", "jun.", "jul.", "ago.", "set.", "out.", "nov.", "dez."];
const day = (iso: string) => {
  const [, month, dayOfMonth] = iso.slice(0, 10).split("-").map(Number);
  return `${dayOfMonth} ${MONTHS[month - 1]}`;
};

export async function notifyUsers(db: Db, userIds: string[], notice: Notice): Promise<number> {
  let created = 0;
  for (const userId of new Set(userIds)) {
    const result = await db.query(
      `INSERT INTO notifications (user_id, kind, payload, dedupe_key) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
      [userId, notice.kind, JSON.stringify({ title: notice.title, body: notice.body, route: notice.route ?? null }), notice.dedupeKey ?? null],
    );
    created += result.rowCount ?? 0;
  }
  return created;
}

export async function staffUserIds(db: Db): Promise<string[]> {
  return (await db.query("SELECT id FROM users WHERE active AND role IN ('admin', 'gestor')")).rows.map((row) => row.id);
}

export async function driverUserIds(db: Db, driverId: string): Promise<string[]> {
  return (await db.query("SELECT id FROM users WHERE active AND driver_id = $1 AND pin_hash IS NOT NULL", [driverId])).rows.map((row) => row.id);
}

export async function notifyStaff(db: Db, notice: Notice) {
  return notifyUsers(db, await staffUserIds(db), notice);
}

export async function notifyDriver(db: Db, driverId: string, notice: Notice) {
  return notifyUsers(db, await driverUserIds(db, driverId), notice);
}

export const notices = {
  weeklyCharge: (charge: { id: string; period_start: string; amount: number; due_at: string }): Notice => ({
    kind: "cobranca",
    title: `Semana de ${day(charge.period_start)}: ${kz(charge.amount)}`,
    body: `Entrega até ${day(charge.due_at)} às 12:00. Veja o cálculo em Pagamentos.`,
    route: "/m/pagamentos",
    dedupeKey: `charge:${charge.id}`,
  }),
  penalty: (chargeId: string, amount: number, week: string): Notice => ({
    kind: "penalidade",
    title: `Penalidade de atraso: ${kz(amount)}`,
    body: `A entrega da semana de ${day(week)} passou do prazo.`,
    route: "/m/pagamentos",
    dedupeKey: `penalty:${chargeId}:${amount}`,
  }),
  breach: (chargeId: string, driverName: string, outstanding: number, week: string): Notice => ({
    kind: "atraso_72h",
    title: `${driverName}: atraso superior a 72 h`,
    body: `Semana de ${day(week)}: faltam ${kz(outstanding)}.`,
    route: "/cobrancas",
    dedupeKey: `breach:${chargeId}`,
  }),
};

/**
 * Avisos que dependem do calendário: lembrete ao motorista no domingo à tarde e documentos a
 * expirar (30 e 7 dias). Idempotente graças às chaves de deduplicação.
 */
export async function runScheduledNotices(db: pg.PoolClient, now: Date) {
  const today = localDateOf(now.getTime(), 60);
  let created = 0;

  // Domingo a partir das 18:00 (Luanda): lembrar a entrega de segunda.
  if (isoWeekday(today) === 7 && now.getTime() >= localTimeToInstant(today, "18:00", 60)) {
    const week = weekStartOf(today);
    const drivers = await db.query("SELECT DISTINCT driver_id FROM assignments WHERE status = 'ativa'");
    for (const row of drivers.rows) {
      created += await notifyDriver(db, row.driver_id, {
        kind: "lembrete",
        title: "Amanhã é dia de entrega",
        body: `Entregue até às 12:00 de ${day(addDays(week, 7))} e envie o comprovativo pela app.`,
        route: "/m/inicio",
        dedupeKey: `reminder:${week}`,
      });
    }
  }

  const docs = await db.query(
    `SELECT d.id, d.type, d.owner_type, d.owner_id, d.valid_until, (d.valid_until - $1::date) AS days_left,
            coalesce(v.plate, dr.name, 'empresa') AS owner_name
     FROM documents d
     LEFT JOIN vehicles v ON d.owner_type = 'vehicle' AND v.id = d.owner_id
     LEFT JOIN drivers dr ON d.owner_type = 'driver' AND dr.id = d.owner_id
     WHERE d.deleted_at IS NULL AND d.valid_until IS NOT NULL AND d.valid_until <= $1::date + 30`,
    [today],
  );
  for (const doc of docs.rows) {
    const daysLeft = Number(doc.days_left);
    const threshold = daysLeft < 0 ? "expirado" : daysLeft <= 7 ? "7" : "30";
    const label = String(doc.type).replaceAll("_", " ");
    const notice: Notice = {
      kind: "documento",
      title: daysLeft < 0 ? `${label} expirado: ${doc.owner_name}` : `${label} expira a ${day(doc.valid_until)}`,
      body: daysLeft < 0 ? `Expirou a ${day(doc.valid_until)}. Renove e registe o novo documento.` : `${doc.owner_name}: faltam ${daysLeft} dia(s).`,
      route: "/documentos",
      dedupeKey: `doc:${doc.id}:${threshold}`,
    };
    created += await notifyStaff(db, notice);
    if (doc.owner_type === "driver") created += await notifyDriver(db, doc.owner_id, { ...notice, route: "/m/perfil" });
  }
  return { created };
}

// --- push (Firebase Cloud Messaging HTTP v1) ------------------------------------------------
// Ativo só com FCM_SERVICE_ACCOUNT (JSON da conta de serviço do projeto Firebase).

type ServiceAccount = { project_id: string; client_email: string; private_key: string };
let cachedToken: { value: string; expiresAt: number } | null = null;

export function fcmConfigured(): boolean {
  return Boolean(process.env.FCM_SERVICE_ACCOUNT);
}

function serviceAccount(): ServiceAccount {
  return JSON.parse(process.env.FCM_SERVICE_ACCOUNT!);
}

/** JWT assinado (RS256) para trocar por um access token OAuth2 da Google. */
export function serviceAccountAssertion(account: ServiceAccount, nowSeconds: number): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const body = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  })}`;
  const signature = createSign("RSA-SHA256").update(body).sign(account.private_key).toString("base64url");
  return `${body}.${signature}`;
}

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const assertion = serviceAccountAssertion(serviceAccount(), Math.floor(Date.now() / 1000));
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!response.ok) throw new Error(`OAuth FCM falhou (${response.status})`);
  const data = (await response.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.value;
}

export function fcmMessage(token: string, payload: { title: string; body: string; route?: string | null }) {
  return {
    message: {
      token,
      notification: { title: payload.title, body: payload.body },
      data: payload.route ? { route: payload.route } : {},
      android: { priority: "high" },
      apns: { payload: { aps: { sound: "default" } } },
    },
  };
}

/** Envia os avisos ainda não enviados (últimas 24 h) para os aparelhos registados. */
export async function dispatchPush(db: pg.Pool) {
  if (!fcmConfigured()) return { sent: 0, skipped: true };
  const pending = await db.query(
    `SELECT n.id, n.payload, t.token FROM notifications n
     LEFT JOIN device_tokens t ON t.user_id = n.user_id
     WHERE n.pushed_at IS NULL AND n.created_at > now() - interval '24 hours'
     ORDER BY n.created_at LIMIT 200`,
  );
  const { project_id: projectId } = serviceAccount();
  let sent = 0;
  const done = new Set<string>();
  for (const row of pending.rows) {
    done.add(row.id);
    if (!row.token) continue;
    const response = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify(fcmMessage(row.token, row.payload)),
    });
    if (response.ok) sent += 1;
    else if (response.status === 404 || response.status === 400) {
      await db.query("DELETE FROM device_tokens WHERE token = $1", [row.token]); // aparelho desinstalado
    }
  }
  if (done.size) await db.query("UPDATE notifications SET pushed_at = now() WHERE id = ANY($1)", [[...done]]);
  return { sent, skipped: false };
}
