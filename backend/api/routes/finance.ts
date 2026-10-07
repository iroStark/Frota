// Cobranças, pagamentos, comprovativos enviados pelo motorista e despesas.
import type { Router } from "express";
import { z } from "zod";
import { pool } from "../../db.js";
import { effectivePaymentTime, splitTotal } from "../../domain/money.ts";
import { HttpError, parse, route } from "../../lib/http.ts";
import { recordPayment, voidCharge, voidPayment } from "../../services/billing.ts";
import {
  audit, driverOnly, isoDate, isoDateTime, kz, notFound, optionalText, requireRole, staff, uuid, withTransaction,
} from "../context.ts";

const PAYMENT_METHODS = ["numerario", "transferencia", "multicaixa", "deposito", "outro"] as const;
const EXPENSE_CATEGORIES = [
  "combustivel", "lavagem", "manutencao", "pneu", "seguro", "multa", "operacional", "documentacao", "outro",
] as const;

const PAID_SUBQUERY = `coalesce((SELECT sum(a.amount) FROM payment_allocations a JOIN payments p ON p.id = a.payment_id
                                 WHERE a.charge_id = c.id AND p.voided_at IS NULL), 0)`;

export function registerFinanceRoutes(router: Router) {
  // --- cobranças -----------------------------------------------------------------------------
  router.get("/charges", staff, route(async (request, response) => {
    const query = parse(z.object({
      driverId: uuid.optional(),
      status: z.enum(["aberta", "parcial", "paga", "isenta", "anulada"]).optional(),
      periodStart: isoDate.optional(),
      overdue: z.enum(["true", "false"]).optional(),
    }), request.query);
    const result = await pool.query(
      `SELECT c.*, d.name AS driver_name, v.plate, ${PAID_SUBQUERY} AS paid
       FROM charges c JOIN drivers d ON d.id = c.driver_id LEFT JOIN vehicles v ON v.id = c.vehicle_id
       WHERE ($1::uuid IS NULL OR c.driver_id = $1)
         AND ($2::text IS NULL OR c.status = $2)
         AND ($3::date IS NULL OR c.period_start = $3)
         AND ($4::boolean IS NOT TRUE OR (c.status IN ('aberta', 'parcial') AND c.due_at < now()))
       ORDER BY c.due_at DESC, d.name
       LIMIT 500`,
      [query.driverId ?? null, query.status ?? null, query.periodStart ?? null, query.overdue === "true"],
    );
    response.json(result.rows.map((row) => ({ ...row, outstanding: row.status === "anulada" ? 0 : Number(row.amount) - Number(row.paid) })));
  }));

  router.post("/charges/:id/void", requireRole("admin"), route(async (request, response) => {
    const id = parse(uuid, request.params.id);
    const body = parse(z.object({ reason: z.string().trim().min(5).max(500) }), request.body);
    await withTransaction(async (db) => {
      if (!(await voidCharge(db, id, body.reason, request.user.sub))) throw notFound("Cobrança");
      await audit(db, request.user.sub, "charge", id, "void", body);
    });
    response.json({ ok: true });
  }));

  // --- pagamentos ----------------------------------------------------------------------------
  router.get("/payments", staff, route(async (request, response) => {
    const query = parse(z.object({ driverId: uuid.optional(), from: isoDate.optional(), to: isoDate.optional() }), request.query);
    const result = await pool.query(
      `SELECT p.*, d.name AS driver_name FROM payments p JOIN drivers d ON d.id = p.driver_id
       WHERE ($1::uuid IS NULL OR p.driver_id = $1)
         AND ($2::date IS NULL OR p.received_at >= ($2::date::timestamp AT TIME ZONE 'Africa/Luanda'))
         AND ($3::date IS NULL OR p.received_at < (($3::date + 1)::timestamp AT TIME ZONE 'Africa/Luanda'))
       ORDER BY p.received_at DESC LIMIT 500`,
      [query.driverId ?? null, query.from ?? null, query.to ?? null],
    );
    response.json(result.rows);
  }));

  router.post("/payments", staff, route(async (request, response) => {
    const body = parse(z.object({
      driverId: uuid,
      amount: z.number().int().positive(),
      receivedAt: isoDateTime,
      method: z.enum(PAYMENT_METHODS),
      reference: optionalText(200),
      notes: optionalText(2000),
      proofFileId: uuid.nullish(),
      clientId: uuid.nullish(),
    }), request.body);
    const result = await withTransaction(async (db) => {
      const recorded = await recordPayment(db, body, request.user.sub);
      if (!recorded.replayed) await audit(db, request.user.sub, "payment", recorded.payment.id, "create", { amount: body.amount, driverId: body.driverId });
      return recorded;
    });
    response.status(result.replayed ? 200 : 201).json(result);
  }));

  /** Vários motoristas de uma vez (ex.: entrega em grupo na segunda-feira). Tudo ou nada. */
  router.post("/payments/batch", staff, route(async (request, response) => {
    const body = parse(z.object({
      receivedAt: isoDateTime,
      method: z.enum(PAYMENT_METHODS),
      reference: optionalText(200),
      proofFileId: uuid.nullish(),
      items: z.array(z.object({ driverId: uuid, amount: z.number().int().positive(), clientId: uuid.nullish(), notes: optionalText(500) })).min(1).max(100),
    }), request.body);
    const results = await withTransaction(async (db) => {
      const out = [];
      for (const item of body.items) {
        const recorded = await recordPayment(db, { ...item, receivedAt: body.receivedAt, method: body.method, reference: body.reference, proofFileId: body.proofFileId }, request.user.sub);
        if (!recorded.replayed) await audit(db, request.user.sub, "payment", recorded.payment.id, "create", { amount: item.amount, driverId: item.driverId, batch: true });
        out.push(recorded);
      }
      return out;
    });
    response.status(201).json(results);
  }));

  router.post("/payments/:id/void", requireRole("admin"), route(async (request, response) => {
    const id = parse(uuid, request.params.id);
    const body = parse(z.object({ reason: z.string().trim().min(5).max(500) }), request.body);
    await withTransaction(async (db) => {
      await voidPayment(db, id, body.reason, request.user.sub);
      await audit(db, request.user.sub, "payment", id, "void", body);
    });
    response.json({ ok: true });
  }));

  // --- comprovativos enviados pelo motorista -------------------------------------------------
  router.post("/me/payment-declarations", driverOnly, route(async (request, response) => {
    const body = parse(z.object({
      amount: z.number().int().positive(),
      paidAt: isoDateTime,
      method: z.enum(PAYMENT_METHODS).default("transferencia"),
      reference: optionalText(200),
      proofFileId: uuid,
      clientId: uuid.nullish(),
    }), request.body);
    if (Date.parse(body.paidAt) > Date.now() + 5 * 60_000) throw new HttpError(422, "data_futura", "A data do pagamento não pode ser no futuro.");
    const declaration = await withTransaction(async (db) => {
      if (body.clientId) {
        const existing = await db.query("SELECT * FROM payment_declarations WHERE client_id = $1 AND driver_id = $2", [body.clientId, request.user.driverId]);
        if (existing.rowCount) return existing.rows[0];
      }
      const file = await db.query("SELECT 1 FROM files WHERE id = $1 AND uploaded_by = $2", [body.proofFileId, request.user.sub]);
      if (!file.rowCount) throw new HttpError(422, "comprovativo_invalido", "Envie primeiro o comprovativo (foto ou PDF).");
      const result = await db.query(
        `INSERT INTO payment_declarations (driver_id, amount, paid_at, method, reference, proof_file_id, client_id, submitted_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [request.user.driverId, body.amount, body.paidAt, body.method, body.reference, body.proofFileId, body.clientId ?? null, request.user.sub],
      );
      await audit(db, request.user.sub, "payment_declaration", result.rows[0].id, "create", { amount: body.amount });
      return result.rows[0];
    });
    response.status(201).json(declaration);
  }));

  router.get("/me/payment-declarations", driverOnly, route(async (request, response) => {
    const result = await pool.query(
      "SELECT * FROM payment_declarations WHERE driver_id = $1 ORDER BY submitted_at DESC LIMIT 100",
      [request.user.driverId],
    );
    response.json(result.rows);
  }));

  router.get("/payment-declarations", staff, route(async (request, response) => {
    const query = parse(z.object({ status: z.enum(["pendente", "confirmada", "rejeitada"]).default("pendente") }), request.query);
    const result = await pool.query(
      `SELECT pd.*, d.name AS driver_name FROM payment_declarations pd JOIN drivers d ON d.id = pd.driver_id
       WHERE pd.status = $1 ORDER BY pd.submitted_at LIMIT 500`,
      [query.status],
    );
    response.json(result.rows);
  }));

  /** Confirmar cria o pagamento. Para o prazo conta a hora do pagamento se o comprovativo chegou até 12h depois. */
  router.post("/payment-declarations/:id/confirm", staff, route(async (request, response) => {
    const id = parse(uuid, request.params.id);
    const body = parse(z.object({ amount: z.number().int().positive().optional() }), request.body ?? {});
    const result = await withTransaction(async (db) => {
      const current = await db.query("SELECT * FROM payment_declarations WHERE id = $1 FOR UPDATE", [id]);
      const declaration = current.rows[0];
      if (!declaration) throw notFound("Comprovativo");
      if (declaration.status !== "pendente") throw new HttpError(409, "ja_revisto", "Este comprovativo já foi revisto.");
      const recorded = await recordPayment(db, {
        driverId: declaration.driver_id,
        amount: body.amount ?? Number(declaration.amount),
        receivedAt: effectivePaymentTime(declaration.paid_at.toISOString(), declaration.submitted_at.toISOString()),
        method: declaration.method,
        reference: declaration.reference,
        proofFileId: declaration.proof_file_id,
        notes: body.amount && body.amount !== Number(declaration.amount)
          ? `Valor confirmado (${body.amount}) difere do declarado (${declaration.amount}).` : null,
      }, request.user.sub);
      await db.query(
        "UPDATE payment_declarations SET status = 'confirmada', payment_id = $2, reviewed_by = $3, reviewed_at = now() WHERE id = $1",
        [id, recorded.payment.id, request.user.sub],
      );
      await audit(db, request.user.sub, "payment_declaration", id, "confirm", { paymentId: recorded.payment.id });
      return recorded;
    });
    response.json(result);
  }));

  router.post("/payment-declarations/:id/reject", staff, route(async (request, response) => {
    const id = parse(uuid, request.params.id);
    const body = parse(z.object({ reason: z.string().trim().min(3).max(500) }), request.body);
    await withTransaction(async (db) => {
      const result = await db.query(
        `UPDATE payment_declarations SET status = 'rejeitada', rejection_reason = $2, reviewed_by = $3, reviewed_at = now()
         WHERE id = $1 AND status = 'pendente'`,
        [id, body.reason, request.user.sub],
      );
      if (!result.rowCount) throw new HttpError(409, "ja_revisto", "Comprovativo inexistente ou já revisto.");
      await audit(db, request.user.sub, "payment_declaration", id, "reject", body);
    });
    response.json({ ok: true });
  }));

  // --- despesas ------------------------------------------------------------------------------
  router.get("/expenses", staff, route(async (request, response) => {
    const query = parse(z.object({ vehicleId: uuid.optional(), from: isoDate.optional(), to: isoDate.optional() }), request.query);
    const result = await pool.query(
      `SELECT e.*, v.plate, b.total AS batch_total, b.vehicle_count AS batch_vehicle_count
       FROM expenses e LEFT JOIN vehicles v ON v.id = e.vehicle_id LEFT JOIN expense_batches b ON b.id = e.batch_id
       WHERE e.deleted_at IS NULL AND ($1::uuid IS NULL OR e.vehicle_id = $1)
         AND ($2::date IS NULL OR e.spent_on >= $2) AND ($3::date IS NULL OR e.spent_on <= $3)
       ORDER BY e.spent_on DESC, e.created_at DESC LIMIT 500`,
      [query.vehicleId ?? null, query.from ?? null, query.to ?? null],
    );
    response.json(result.rows);
  }));

  /**
   * mode "unica": uma viatura (ou nenhuma = despesa geral).
   * mode "por_viatura": o valor indicado é de cada viatura; total = valor × N.
   * mode "dividir_total": o valor indicado é o total, dividido pelas viaturas sem perder kwanzas.
   */
  router.post("/expenses", staff, route(async (request, response) => {
    const body = parse(z.object({
      mode: z.enum(["unica", "por_viatura", "dividir_total"]),
      vehicleIds: z.array(uuid).max(200).default([]),
      allActiveVehicles: z.boolean().default(false),
      amount: kz,
      category: z.enum(EXPENSE_CATEGORIES),
      responsible: z.enum(["proprietaria", "motorista"]).default("proprietaria"),
      spentOn: isoDate,
      supplier: optionalText(200),
      receiptFileId: uuid.nullish(),
      notes: optionalText(2000),
      clientId: uuid.nullish(),
    }), request.body);
    const result = await withTransaction(async (db) => {
      if (body.clientId) {
        const existing = await db.query("SELECT * FROM expenses WHERE client_id = $1", [body.clientId]);
        if (existing.rowCount) return { batch: null, expenses: existing.rows, replayed: true };
      }
      let vehicleIds = [...new Set(body.vehicleIds)];
      if (body.allActiveVehicles) {
        const active = await db.query("SELECT id FROM vehicles WHERE deleted_at IS NULL AND status IN ('em_servico', 'disponivel') ORDER BY plate");
        vehicleIds = active.rows.map((row) => row.id);
      }
      if (vehicleIds.length) {
        const found = await db.query("SELECT count(*)::int AS n FROM vehicles WHERE id = ANY($1) AND deleted_at IS NULL", [vehicleIds]);
        if (found.rows[0].n !== vehicleIds.length) throw notFound("Viatura");
      }
      if (body.mode !== "unica" && vehicleIds.length < 1) throw new HttpError(422, "sem_viaturas", "Escolha as viaturas.");
      if (body.mode === "unica" && vehicleIds.length > 1) throw new HttpError(422, "varias_viaturas", "Para várias viaturas use um lote.");

      const amounts = body.mode === "dividir_total" ? splitTotal(body.amount, vehicleIds.length)
        : body.mode === "por_viatura" ? vehicleIds.map(() => body.amount)
        : [body.amount];
      let batch = null;
      if (body.mode !== "unica") {
        const total = amounts.reduce((sum, value) => sum + value, 0);
        batch = (await db.query(
          `INSERT INTO expense_batches (mode, category, description, vehicle_count, amount_per_vehicle, total, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
          [body.mode, body.category, body.notes, vehicleIds.length, body.mode === "por_viatura" ? body.amount : amounts[0], total, request.user.sub],
        )).rows[0];
      }
      const targets: (string | null)[] = body.mode === "unica" ? [vehicleIds[0] ?? null] : vehicleIds;
      const expenses = [];
      for (const [index, vehicleId] of targets.entries()) {
        expenses.push((await db.query(
          `INSERT INTO expenses (vehicle_id, batch_id, category, responsible, amount, spent_on, supplier, receipt_file_id, notes, client_id, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
          [vehicleId, batch?.id ?? null, body.category, body.responsible, amounts[index], body.spentOn, body.supplier,
            body.receiptFileId ?? null, body.notes, index === 0 ? body.clientId ?? null : null, request.user.sub],
        )).rows[0]);
      }
      await audit(db, request.user.sub, "expense", batch?.id ?? expenses[0].id, "create", { mode: body.mode, total: amounts.reduce((a, b) => a + b, 0) });
      return { batch, expenses, replayed: false };
    });
    response.status(result.replayed ? 200 : 201).json(result);
  }));

  router.delete("/expenses/:id", staff, route(async (request, response) => {
    const id = parse(uuid, request.params.id);
    await withTransaction(async (db) => {
      const result = await db.query("UPDATE expenses SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL", [id]);
      if (!result.rowCount) throw notFound("Despesa");
      await audit(db, request.user.sub, "expense", id, "delete");
    });
    response.status(204).end();
  }));
}
