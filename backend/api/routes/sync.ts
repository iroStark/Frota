// Sincronização incremental para a cache offline da app.
// O cliente guarda o `cursor` devolvido e envia-o como `since` no pedido seguinte. O cursor recua
// alguns segundos para não perder transações que confirmaram depois de começarem; o cliente
// deduplica por id (as linhas trazem sempre o estado completo e atual).
import type { Router } from "express";
import { z } from "zod";
import { parse, route } from "../../lib/http.ts";
import type { AccessClaims } from "../../lib/security.ts";
import { type Db, withClient } from "../context.ts";

const OVERLAP_SECONDS = 5;

type Entity = { name: string; staff: string; driver?: string };

const changed = (alias: string, columns: string[]) => `greatest(${columns.map((column) => `${alias}.${column}`).join(", ")}) > $1`;

const ENTITIES: Entity[] = [
  {
    name: "vehicles",
    staff: `SELECT v.* FROM vehicles v WHERE ${changed("v", ["created_at", "updated_at", "deleted_at"])}`,
    driver: `SELECT v.* FROM vehicles v JOIN assignments a ON a.vehicle_id = v.id AND a.driver_id = $2
             WHERE ${changed("v", ["created_at", "updated_at", "deleted_at"])}`,
  },
  {
    name: "drivers",
    staff: `SELECT d.* FROM drivers d WHERE ${changed("d", ["created_at", "updated_at", "deleted_at"])}`,
    driver: `SELECT d.* FROM drivers d WHERE d.id = $2 AND ${changed("d", ["created_at", "updated_at", "deleted_at"])}`,
  },
  {
    name: "assignments",
    staff: `SELECT a.* FROM assignments a WHERE ${changed("a", ["created_at", "updated_at"])}`,
    driver: `SELECT a.* FROM assignments a WHERE a.driver_id = $2 AND ${changed("a", ["created_at", "updated_at"])}`,
  },
  {
    name: "incidents",
    staff: `SELECT i.* FROM incidents i WHERE ${changed("i", ["created_at", "updated_at"])}`,
    driver: `SELECT i.* FROM incidents i WHERE i.driver_id = $2 AND ${changed("i", ["created_at", "updated_at"])}`,
  },
  {
    name: "documents",
    staff: `SELECT d.* FROM documents d WHERE ${changed("d", ["created_at", "updated_at", "deleted_at"])}`,
    driver: `SELECT d.* FROM documents d WHERE d.owner_type = 'driver' AND d.owner_id = $2 AND ${changed("d", ["created_at", "updated_at", "deleted_at"])}`,
  },
  {
    // O valor pago muda quando chegam pagamentos: inclui também cobranças com alocações recentes.
    name: "charges",
    staff: `SELECT c.*, coalesce((SELECT sum(al.amount) FROM payment_allocations al JOIN payments p ON p.id = al.payment_id
                                  WHERE al.charge_id = c.id AND p.voided_at IS NULL), 0) AS paid
            FROM charges c
            WHERE ${changed("c", ["created_at", "updated_at"])}
               OR EXISTS (SELECT 1 FROM payment_allocations al JOIN payments p ON p.id = al.payment_id
                          WHERE al.charge_id = c.id AND greatest(p.created_at, p.voided_at) > $1)`,
    driver: `SELECT c.*, coalesce((SELECT sum(al.amount) FROM payment_allocations al JOIN payments p ON p.id = al.payment_id
                                   WHERE al.charge_id = c.id AND p.voided_at IS NULL), 0) AS paid
             FROM charges c
             WHERE c.driver_id = $2 AND (${changed("c", ["created_at", "updated_at"])}
               OR EXISTS (SELECT 1 FROM payment_allocations al JOIN payments p ON p.id = al.payment_id
                          WHERE al.charge_id = c.id AND greatest(p.created_at, p.voided_at) > $1))`,
  },
  {
    name: "payments",
    staff: `SELECT p.* FROM payments p WHERE ${changed("p", ["created_at", "voided_at"])}`,
    driver: `SELECT p.* FROM payments p WHERE p.driver_id = $2 AND ${changed("p", ["created_at", "voided_at"])}`,
  },
  {
    name: "payment_declarations",
    staff: `SELECT pd.* FROM payment_declarations pd WHERE ${changed("pd", ["submitted_at", "reviewed_at"])}`,
    driver: `SELECT pd.* FROM payment_declarations pd WHERE pd.driver_id = $2 AND ${changed("pd", ["submitted_at", "reviewed_at"])}`,
  },
  {
    name: "expenses",
    staff: `SELECT e.* FROM expenses e WHERE ${changed("e", ["created_at", "updated_at", "deleted_at"])}`,
  },
];

async function changesSince(db: Db, user: AccessClaims, since: Date) {
  const cursor = (await db.query(`SELECT now() - make_interval(secs => ${OVERLAP_SECONDS}) AS cursor`)).rows[0].cursor as Date;
  const changes: Record<string, unknown[]> = {};
  const isDriver = user.role === "motorista";
  for (const entity of ENTITIES) {
    const sql = isDriver ? entity.driver : entity.staff;
    if (!sql) continue;
    changes[entity.name] = (await db.query(sql, isDriver ? [since, user.driverId] : [since])).rows;
  }
  return { cursor: cursor.toISOString(), changes };
}

export function registerSyncRoutes(router: Router) {
  router.get("/sync/changes", route(async (request, response) => {
    const query = parse(z.object({ since: z.iso.datetime({ offset: true }).optional() }), request.query);
    const since = new Date(query.since ?? 0);
    response.json(await withClient(async (db) => {
      await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      try {
        return await changesSince(db, request.user, since);
      } finally {
        await db.query("COMMIT");
      }
    }));
  }));
}
