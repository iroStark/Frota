// Cadastro: viaturas, motoristas (com contactos) e documentos.
import type { Router } from "express";
import { z } from "zod";
import { pool } from "../../db.js";
import { HttpError, parse, route } from "../../lib/http.ts";
import { normalizePhone } from "../../services/auth.ts";
import { localDateOf } from "../../domain/time.ts";
import { driverStatement, rulesAt } from "../../services/billing.ts";
import { refreshVehicleStatus } from "../../services/fleet.ts";
import {
  type Db, assertDriverAccess, audit, isoDate, kz, notFound, optionalText, requireRole, staff, updateColumns, uuid, withClient, withTransaction,
} from "../context.ts";

const vehicleFields = z.object({
  brand: z.string().trim().min(1).max(60),
  model: z.string().trim().min(1).max(60),
  plate: optionalText(20).transform((value) => value?.toUpperCase() ?? null),
  color: optionalText(40),
  year: z.number().int().min(1950).max(2100).nullish(),
  chassis: optionalText(60),
  mileage: z.number().int().nonnegative().nullish(),
  photoFileId: uuid.nullish(),
});

function vehicleColumns(body: Partial<z.infer<typeof vehicleFields>>) {
  return {
    brand: body.brand, model: body.model, plate: body.plate, color: body.color, year: body.year,
    chassis: body.chassis, mileage: body.mileage, photo_file_id: body.photoFileId,
  };
}

const contactSchema = z.object({ name: z.string().trim().min(1).max(100), relation: optionalText(40), phone: optionalText(30) });

const driverFields = z.object({
  name: z.string().trim().min(2).max(120),
  phone: optionalText(30).transform((value) => (value ? normalizePhone(value) : null)),
  bi: optionalText(30),
  nif: optionalText(30),
  licenseNumber: optionalText(40),
  licenseCategory: optionalText(20),
  address: optionalText(300),
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  deposit: kz.optional(),
  contractStart: isoDate.nullish(),
  photoFileId: uuid.nullish(),
  contacts: z.array(contactSchema).max(5).optional(),
});

function driverColumns(body: Partial<z.infer<typeof driverFields>>) {
  return {
    name: body.name, phone: body.phone, bi: body.bi, nif: body.nif, license_number: body.licenseNumber,
    license_category: body.licenseCategory, address: body.address, latitude: body.latitude, longitude: body.longitude,
    deposit: body.deposit, contract_start: body.contractStart, photo_file_id: body.photoFileId,
  };
}

async function replaceContacts(db: Db, driverId: string, contacts: z.infer<typeof contactSchema>[] | undefined) {
  if (!contacts) return;
  await db.query("DELETE FROM driver_contacts WHERE driver_id = $1", [driverId]);
  for (const [position, contact] of contacts.entries()) {
    await db.query(
      "INSERT INTO driver_contacts (driver_id, name, relation, phone, position) VALUES ($1, $2, $3, $4, $5)",
      [driverId, contact.name, contact.relation, contact.phone ? normalizePhone(contact.phone) : null, position],
    );
  }
}

const documentFields = z.object({
  ownerType: z.enum(["vehicle", "driver", "company"]),
  ownerId: uuid.nullish(),
  type: z.enum([
    "bilhete_identidade", "carta_conducao", "livrete", "titulo_propriedade", "seguro", "inspecao",
    "imposto_circulacao", "licenca_taxi", "contrato", "outro",
  ]),
  number: optionalText(60),
  issuedOn: isoDate.nullish(),
  validUntil: isoDate.nullish(),
  fileId: uuid.nullish(),
  notes: optionalText(1000),
});

async function assertOwnerExists(db: Db, ownerType: string, ownerId: string | null | undefined) {
  if (ownerType === "company") {
    if (ownerId) throw new HttpError(422, "dono_invalido", "Documentos da empresa não têm dono.");
    return;
  }
  if (!ownerId) throw new HttpError(422, "dono_invalido", "Indique a viatura ou o motorista.");
  const table = ownerType === "vehicle" ? "vehicles" : "drivers";
  const exists = await db.query(`SELECT 1 FROM ${table} WHERE id = $1 AND deleted_at IS NULL`, [ownerId]);
  if (!exists.rowCount) throw notFound(ownerType === "vehicle" ? "Viatura" : "Motorista");
}

export const DOCUMENT_SELECT = `
  SELECT d.*, CASE WHEN d.valid_until IS NULL THEN 'sem_validade'
                   WHEN d.valid_until < current_date THEN 'expirado'
                   WHEN d.valid_until <= current_date + 30 THEN 'a_expirar'
                   ELSE 'valido' END AS validity
  FROM documents d`;

export function registerFleetRoutes(router: Router) {
  // --- regras do contrato em vigor (valores sugeridos na app) --------------------------------
  router.get("/contract-rules/current", staff, route(async (_request, response) => {
    const today = localDateOf(Date.now(), 60);
    const current = await withClient((db) => rulesAt(db, today));
    response.json({ effectiveOn: today, weeklyFee: current.weeklyFee, ...current.extra, rules: current.rules });
  }));

  router.get("/contract-rules", staff, route(async (_request, response) => {
    const result = await pool.query(
      `SELECT c.id, c.effective_from, c.weekly_fee, c.rules, c.created_at, u.name AS created_by_name
       FROM contract_rules c LEFT JOIN users u ON u.id = c.created_by ORDER BY c.effective_from DESC`,
    );
    response.json(result.rows);
  }));

  /**
   * Nova versão das regras (só admin). Vale a partir de `effectiveFrom` (hoje ou depois): semanas
   * já cobradas não mudam; cada semana usa as regras em vigor na sua segunda-feira.
   */
  router.post("/contract-rules", requireRole("admin"), route(async (request, response) => {
    const body = parse(z.object({
      effectiveFrom: isoDate,
      weeklyFee: kz.refine((value) => value > 0, "Maior que zero."),
      penaltyLate24: kz,
      penaltyLate72: kz,
      fineOffHours: kz,
      returnDelayDaily: kz,
      deductibleLimit: kz,
      deliveryHour: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora HH:MM."),
      minStopHours: z.number().min(0).max(24),
    }), request.body);
    const today = localDateOf(Date.now(), 60);
    if (body.effectiveFrom < today) throw new HttpError(422, "data_passada", "As novas regras só podem valer a partir de hoje.");
    const saved = await withTransaction(async (db) => {
      const current = await rulesAt(db, body.effectiveFrom);
      const { weeklyFee, effectiveFrom, ...values } = body;
      const rules = { ...current.extra, ...values };
      const result = await db.query(
        `INSERT INTO contract_rules (effective_from, weekly_fee, rules, created_by) VALUES ($1, $2, $3, $4)
         ON CONFLICT (effective_from) DO UPDATE SET weekly_fee = EXCLUDED.weekly_fee, rules = EXCLUDED.rules,
           created_by = EXCLUDED.created_by, created_at = now()
         RETURNING *`,
        [effectiveFrom, weeklyFee, JSON.stringify(rules), request.user.sub],
      );
      await audit(db, request.user.sub, "contract_rules", result.rows[0].id, "save", body);
      return result.rows[0];
    });
    response.status(201).json(saved);
  }));

  // --- viaturas ------------------------------------------------------------------------------
  router.get("/vehicles", staff, route(async (request, response) => {
    const query = parse(z.object({
      status: z.enum(["disponivel", "em_servico", "imobilizada", "abatida"]).optional(),
      search: z.string().trim().max(60).optional(),
    }), request.query);
    const result = await pool.query(
      `SELECT v.*, a.id AS assignment_id, a.start_at AS assigned_since, d.id AS driver_id, d.name AS driver_name
       FROM vehicles v
       LEFT JOIN assignments a ON a.vehicle_id = v.id AND a.status = 'ativa'
       LEFT JOIN drivers d ON d.id = a.driver_id
       WHERE v.deleted_at IS NULL AND ($1::text IS NULL OR v.status = $1)
         AND ($2::text IS NULL OR v.plate ILIKE '%' || $2 || '%' OR v.brand ILIKE '%' || $2 || '%'
              OR v.model ILIKE '%' || $2 || '%' OR d.name ILIKE '%' || $2 || '%')
       ORDER BY v.status, v.plate NULLS LAST`,
      [query.status ?? null, query.search ?? null],
    );
    response.json(result.rows);
  }));

  router.get("/vehicles/:id", staff, route(async (request, response) => {
    const id = parse(uuid, request.params.id);
    const vehicle = await pool.query("SELECT * FROM vehicles WHERE id = $1 AND deleted_at IS NULL", [id]);
    if (!vehicle.rowCount) throw notFound("Viatura");
    const [assignments, documents, incidents, expenses] = await Promise.all([
      pool.query(
        `SELECT a.*, d.name AS driver_name FROM assignments a JOIN drivers d ON d.id = a.driver_id
         WHERE a.vehicle_id = $1 ORDER BY a.start_at DESC`, [id]),
      pool.query(`${DOCUMENT_SELECT} WHERE d.owner_type = 'vehicle' AND d.owner_id = $1 AND d.deleted_at IS NULL ORDER BY d.valid_until NULLS LAST`, [id]),
      pool.query("SELECT * FROM incidents WHERE vehicle_id = $1 ORDER BY start_at DESC LIMIT 50", [id]),
      pool.query(
        `SELECT coalesce(sum(amount) FILTER (WHERE responsible = 'proprietaria'), 0) AS owner_total,
                coalesce(sum(amount) FILTER (WHERE responsible = 'motorista'), 0) AS driver_total
         FROM expenses WHERE vehicle_id = $1 AND deleted_at IS NULL`, [id]),
    ]);
    response.json({
      ...vehicle.rows[0],
      activeAssignment: assignments.rows.find((row) => row.status === "ativa") ?? null,
      assignments: assignments.rows,
      documents: documents.rows,
      incidents: incidents.rows,
      expenseTotals: expenses.rows[0],
    });
  }));

  router.post("/vehicles", staff, route(async (request, response) => {
    const body = parse(vehicleFields, request.body);
    const vehicle = await withTransaction(async (db) => {
      const result = await db.query(
        `INSERT INTO vehicles (brand, model, plate, color, year, chassis, mileage, photo_file_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [body.brand, body.model, body.plate, body.color, body.year ?? null, body.chassis, body.mileage ?? null, body.photoFileId ?? null],
      );
      await audit(db, request.user.sub, "vehicle", result.rows[0].id, "create", body);
      return result.rows[0];
    });
    response.status(201).json(vehicle);
  }));

  router.patch("/vehicles/:id", staff, route(async (request, response) => {
    const id = parse(uuid, request.params.id);
    const body = parse(vehicleFields.partial().extend({ retired: z.boolean().optional() }), request.body);
    const vehicle = await withTransaction(async (db) => {
      const before = await db.query("SELECT * FROM vehicles WHERE id = $1 AND deleted_at IS NULL FOR UPDATE", [id]);
      if (!before.rowCount) throw notFound("Viatura");
      if (body.retired !== undefined) {
        const active = await db.query("SELECT 1 FROM assignments WHERE vehicle_id = $1 AND status = 'ativa'", [id]);
        if (body.retired && active.rowCount) throw new HttpError(409, "viatura_atribuida", "Devolva a viatura antes de a abater.");
        await db.query("UPDATE vehicles SET status = $2 WHERE id = $1", [id, body.retired ? "abatida" : "disponivel"]);
        if (!body.retired) await refreshVehicleStatus(db, id);
      }
      const updated = await updateColumns(db, "vehicles", id, vehicleColumns(body));
      await audit(db, request.user.sub, "vehicle", id, "update", body);
      return updated;
    });
    response.json(vehicle);
  }));

  router.delete("/vehicles/:id", staff, route(async (request, response) => {
    const id = parse(uuid, request.params.id);
    await withTransaction(async (db) => {
      const active = await db.query("SELECT 1 FROM assignments WHERE vehicle_id = $1 AND status = 'ativa'", [id]);
      if (active.rowCount) throw new HttpError(409, "viatura_atribuida", "Devolva a viatura antes de a remover.");
      const result = await db.query("UPDATE vehicles SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL", [id]);
      if (!result.rowCount) throw notFound("Viatura");
      await audit(db, request.user.sub, "vehicle", id, "delete");
    });
    response.status(204).end();
  }));

  // --- motoristas ----------------------------------------------------------------------------
  router.get("/drivers", staff, route(async (request, response) => {
    const query = parse(z.object({ search: z.string().trim().max(60).optional() }), request.query);
    const result = await pool.query(
      `SELECT d.id, d.name, d.phone, d.photo_file_id,
              a.id AS assignment_id, v.id AS vehicle_id, v.plate, v.brand, v.model,
              coalesce(ch.total, 0) - coalesce(pay.total, 0) AS balance,
              coalesce(ch.overdue, 0) AS overdue,
              u.id IS NOT NULL AND u.pin_hash IS NOT NULL AS has_app_access
       FROM drivers d
       LEFT JOIN assignments a ON a.driver_id = d.id AND a.status = 'ativa'
       LEFT JOIN vehicles v ON v.id = a.vehicle_id
       LEFT JOIN users u ON u.driver_id = d.id
       LEFT JOIN LATERAL (
         SELECT sum(c.amount) AS total,
                sum(c.amount - coalesce((SELECT sum(al.amount) FROM payment_allocations al JOIN payments p ON p.id = al.payment_id
                                         WHERE al.charge_id = c.id AND p.voided_at IS NULL), 0))
                  FILTER (WHERE c.status IN ('aberta', 'parcial') AND c.due_at < now()) AS overdue
         FROM charges c WHERE c.driver_id = d.id AND c.status <> 'anulada') ch ON true
       LEFT JOIN LATERAL (SELECT sum(amount) AS total FROM payments WHERE driver_id = d.id AND voided_at IS NULL) pay ON true
       WHERE d.deleted_at IS NULL AND ($1::text IS NULL OR d.name ILIKE '%' || $1 || '%' OR d.phone ILIKE '%' || $1 || '%')
       ORDER BY d.name`,
      [query.search ?? null],
    );
    response.json(result.rows);
  }));

  router.get("/drivers/:id", route(async (request, response) => {
    const id = parse(uuid, request.params.id);
    assertDriverAccess(request.user, id);
    const driver = await pool.query("SELECT * FROM drivers WHERE id = $1 AND deleted_at IS NULL", [id]);
    if (!driver.rowCount) throw notFound("Motorista");
    const [contacts, assignment, documents, account] = await Promise.all([
      pool.query("SELECT id, name, relation, phone FROM driver_contacts WHERE driver_id = $1 ORDER BY position", [id]),
      pool.query(
        `SELECT a.*, v.brand, v.model, v.plate, v.status AS vehicle_status FROM assignments a JOIN vehicles v ON v.id = a.vehicle_id
         WHERE a.driver_id = $1 AND a.status = 'ativa'`, [id]),
      pool.query(`${DOCUMENT_SELECT} WHERE d.owner_type = 'driver' AND d.owner_id = $1 AND d.deleted_at IS NULL ORDER BY d.valid_until NULLS LAST`, [id]),
      pool.query("SELECT pin_hash IS NOT NULL AS activated, active, last_login_at FROM users WHERE driver_id = $1", [id]),
    ]);
    response.json({
      ...driver.rows[0],
      contacts: contacts.rows,
      activeAssignment: assignment.rows[0] ?? null,
      documents: documents.rows,
      appAccess: account.rows[0] ?? null,
    });
  }));

  router.get("/drivers/:id/statement", route(async (request, response) => {
    const id = parse(uuid, request.params.id);
    assertDriverAccess(request.user, id);
    response.json(await withClient((db) => driverStatement(db, id)));
  }));

  router.post("/drivers", staff, route(async (request, response) => {
    const body = parse(driverFields, request.body);
    const driver = await withTransaction(async (db) => {
      const columns = driverColumns(body);
      const keys = Object.keys(columns).filter((key) => columns[key as keyof typeof columns] !== undefined);
      const result = await db.query(
        `INSERT INTO drivers (${keys.join(", ")}) VALUES (${keys.map((_, index) => `$${index + 1}`).join(", ")}) RETURNING *`,
        keys.map((key) => columns[key as keyof typeof columns] ?? null),
      );
      await replaceContacts(db, result.rows[0].id, body.contacts);
      await audit(db, request.user.sub, "driver", result.rows[0].id, "create", { ...body, bi: body.bi ? "***" : null });
      return result.rows[0];
    });
    response.status(201).json(driver);
  }));

  router.patch("/drivers/:id", staff, route(async (request, response) => {
    const id = parse(uuid, request.params.id);
    const body = parse(driverFields.partial(), request.body);
    const driver = await withTransaction(async (db) => {
      const updated = await updateColumns(db, "drivers", id, driverColumns(body), "AND deleted_at IS NULL");
      if (!updated) throw notFound("Motorista");
      await replaceContacts(db, id, body.contacts);
      if (body.phone) await db.query("UPDATE users SET phone = $2 WHERE driver_id = $1", [id, body.phone]);
      if (body.name) await db.query("UPDATE users SET name = $2 WHERE driver_id = $1", [id, body.name]);
      await audit(db, request.user.sub, "driver", id, "update", Object.keys(body));
      return updated;
    });
    response.json(driver);
  }));

  router.delete("/drivers/:id", staff, route(async (request, response) => {
    const id = parse(uuid, request.params.id);
    await withTransaction(async (db) => {
      const active = await db.query("SELECT 1 FROM assignments WHERE driver_id = $1 AND status = 'ativa'", [id]);
      if (active.rowCount) throw new HttpError(409, "motorista_com_viatura", "Devolva a viatura do motorista antes de o remover.");
      const result = await db.query("UPDATE drivers SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL", [id]);
      if (!result.rowCount) throw notFound("Motorista");
      await db.query("UPDATE users SET active = false WHERE driver_id = $1", [id]);
      await db.query("UPDATE refresh_tokens SET revoked_at = now() WHERE user_id IN (SELECT id FROM users WHERE driver_id = $1) AND revoked_at IS NULL", [id]);
      await audit(db, request.user.sub, "driver", id, "delete");
    });
    response.status(204).end();
  }));

  // --- documentos ----------------------------------------------------------------------------
  router.get("/documents", staff, route(async (request, response) => {
    const query = parse(z.object({
      ownerType: z.enum(["vehicle", "driver", "company"]).optional(),
      ownerId: uuid.optional(),
      expiringWithinDays: z.coerce.number().int().min(0).max(365).optional(),
    }), request.query);
    const result = await pool.query(
      `${DOCUMENT_SELECT}
       WHERE d.deleted_at IS NULL AND ($1::text IS NULL OR d.owner_type = $1) AND ($2::uuid IS NULL OR d.owner_id = $2)
         AND ($3::int IS NULL OR (d.valid_until IS NOT NULL AND d.valid_until <= current_date + $3))
       ORDER BY d.valid_until NULLS LAST`,
      [query.ownerType ?? null, query.ownerId ?? null, query.expiringWithinDays ?? null],
    );
    response.json(result.rows);
  }));

  router.post("/documents", staff, route(async (request, response) => {
    const body = parse(documentFields, request.body);
    const document = await withTransaction(async (db) => {
      await assertOwnerExists(db, body.ownerType, body.ownerId);
      const result = await db.query(
        `INSERT INTO documents (owner_type, owner_id, type, number, issued_on, valid_until, file_id, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [body.ownerType, body.ownerType === "company" ? null : body.ownerId, body.type, body.number,
          body.issuedOn ?? null, body.validUntil ?? null, body.fileId ?? null, body.notes],
      );
      await audit(db, request.user.sub, "document", result.rows[0].id, "create", { type: body.type, ownerType: body.ownerType });
      return result.rows[0];
    });
    response.status(201).json(document);
  }));

  router.patch("/documents/:id", staff, route(async (request, response) => {
    const id = parse(uuid, request.params.id);
    const body = parse(documentFields.omit({ ownerType: true, ownerId: true }).partial(), request.body);
    const document = await withTransaction(async (db) => {
      const updated = await updateColumns(db, "documents", id, {
        type: body.type, number: body.number, issued_on: body.issuedOn, valid_until: body.validUntil,
        file_id: body.fileId, notes: body.notes,
      }, "AND deleted_at IS NULL");
      if (!updated) throw notFound("Documento");
      await audit(db, request.user.sub, "document", id, "update", Object.keys(body));
      return updated;
    });
    response.json(document);
  }));

  router.delete("/documents/:id", staff, route(async (request, response) => {
    const id = parse(uuid, request.params.id);
    await withTransaction(async (db) => {
      const result = await db.query("UPDATE documents SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL", [id]);
      if (!result.rowCount) throw notFound("Documento");
      await audit(db, request.user.sub, "document", id, "delete");
    });
    response.status(204).end();
  }));
}
