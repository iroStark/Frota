// Transforma o estado JSON do PWA (app_state.payload) nas linhas do modelo normalizado.
// Função pura: não toca na base de dados. A escrita está em import-legacy.ts.
//
// Decisões de importação (documentadas no relatório):
// - Pagamentos antigos com vencimento na segunda M passam a pagar a semana que terminou (M-7 … M-1).
// - "Isenção de semana" antiga vira uma paragem que cobre essa semana inteira.
// - Penalidades históricas só são criadas no valor efetivamente pago (penaltyPaid); as que o motor
//   calcularia mas nunca foram cobradas aparecem no relatório para decisão do gestor.

import { randomUUID } from "node:crypto";
import {
  type ContractRules,
  DEFAULT_RULES,
  type StopPeriod,
  allocatePayment,
  billableWeeks,
  calculateWeeklyCharge,
  chargeStatus,
  latePenalty,
} from "../domain/charges.ts";
import { addDays, localDateOf, localTimeToInstant, parseInstant, weekStartOf } from "../domain/time.ts";

type Legacy = Record<string, any>;
type Row = Record<string, unknown>;

export type ImportPlan = {
  rows: {
    files: Row[];
    vehicles: Row[];
    drivers: Row[];
    driver_contacts: Row[];
    documents: Row[];
    assignments: Row[];
    incidents: Row[];
    expense_batches: Row[];
    expenses: Row[];
    charges: Row[];
    payments: Row[];
    payment_allocations: Row[];
  };
  report: ImportReport;
};

export type DriverSummary = {
  driverId: string;
  name: string;
  weeksCharged: number;
  totalCharged: number;
  totalPaid: number;
  balance: number;
  openWeeks: string[];
  uncollectedPenalties: number;
};

export type ImportReport = {
  generatedAt: string;
  counts: Record<string, number>;
  warnings: string[];
  drivers: DriverSummary[];
};

const EXEMPT_TYPES = new Set(["doenca", "licenca", "manutencao", "paragem_tecnica", "sinistro", "avaria"]);

const DOCUMENT_TYPES: Record<string, string> = {
  "Livrete": "livrete",
  "Título de Propriedade": "titulo_propriedade",
  "Inspecção Periódica": "inspecao",
  "Seguro Obrigatório": "seguro",
  "Selo do Imposto de Circulação": "imposto_circulacao",
  "Bilhete de Identidade": "bilhete_identidade",
  "Carta de Condução": "carta_conducao",
  "Licenciamento de táxi": "licenca_taxi",
};

function text(value: unknown): string | null {
  const result = String(value ?? "").trim();
  return result ? result : null;
}

function int(value: unknown): number | null {
  const result = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(result) ? result : null;
}

function money(value: unknown): number {
  const result = Math.round(Number(value || 0));
  return Number.isFinite(result) && result > 0 ? result : 0;
}

function isoOrNull(value: unknown): string | null {
  if (!value) return null;
  const ms = Date.parse(String(value));
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function dateOnly(value: unknown): string | null {
  const iso = text(value);
  return iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : null;
}

export function planLegacyImport(
  payload: Legacy,
  options: { now?: string; rules?: ContractRules } = {},
): ImportPlan {
  const now = options.now ?? new Date().toISOString();
  const rules = options.rules ?? {
    ...DEFAULT_RULES,
    deliveryHour: payload.settings?.deliveryHour || DEFAULT_RULES.deliveryHour,
    penaltyLate24: Number(payload.settings?.penaltyLate24 ?? DEFAULT_RULES.penaltyLate24),
    penaltyLate72: Number(payload.settings?.penaltyLate72 ?? DEFAULT_RULES.penaltyLate72),
  };
  const defaultFee = money(payload.settings?.weeklyFee) || 130000;
  const warnings: string[] = [];
  const rows: ImportPlan["rows"] = {
    files: [], vehicles: [], drivers: [], driver_contacts: [], documents: [], assignments: [],
    incidents: [], expense_batches: [], expenses: [], charges: [], payments: [], payment_allocations: [],
  };

  const list = (key: string): Legacy[] => (Array.isArray(payload[key]) ? payload[key] : []);

  // --- ficheiros embutidos -------------------------------------------------------------------
  const fileIds = new Map<string, string>();
  const fileRef = (upload: Legacy | undefined | null): string | null => {
    if (!upload?.url || !upload.storedName) return null;
    const key = String(upload.id || upload.storedName);
    if (!fileIds.has(key)) {
      const id = /^[0-9a-f-]{36}$/i.test(String(upload.id)) ? String(upload.id) : randomUUID();
      fileIds.set(key, id);
      rows.files.push({
        id,
        original_name: upload.originalName || upload.storedName,
        storage_key: upload.storedName,
        mime_type: upload.mimeType || "application/octet-stream",
        size_bytes: Number(upload.size || 0),
        category: upload.category || "documento",
        created_at: isoOrNull(upload.uploadedAt) ?? now,
      });
    }
    return fileIds.get(key)!;
  };

  // --- motoristas ---------------------------------------------------------------------------
  const driverIds = new Map<string, string>();
  const driverNames = new Map<string, string>();
  for (const driver of list("drivers")) {
    const id = randomUUID();
    driverIds.set(String(driver.id), id);
    driverNames.set(id, text(driver.name) ?? "Motorista sem nome");
    rows.drivers.push({
      id,
      name: text(driver.name) ?? "Motorista sem nome",
      phone: text(driver.phone),
      bi: text(driver.bi),
      nif: text(driver.nif),
      license_number: text(driver.license),
      license_category: text(driver.category),
      address: text(driver.address),
      latitude: driver.addressLocation?.latitude ?? null,
      longitude: driver.addressLocation?.longitude ?? null,
      deposit: money(driver.deposit),
      contract_start: dateOnly(driver.contractStart),
      photo_file_id: fileRef(driver.files?.photo),
      legacy_id: String(driver.id),
      created_at: isoOrNull(driver.createdAt) ?? now,
    });
    (Array.isArray(driver.contacts) ? driver.contacts : []).forEach((contact: Legacy, position: number) => {
      if (!text(contact.name) && !text(contact.phone)) return;
      rows.driver_contacts.push({
        id: randomUUID(), driver_id: id, name: text(contact.name) ?? "Contacto",
        relation: text(contact.relation), phone: text(contact.phone), position,
      });
    });
    const personalDocs: [string, unknown, unknown, Legacy | undefined][] = [
      ["bilhete_identidade", driver.bi, driver.biValid, driver.files?.bi],
      ["carta_conducao", driver.license, driver.licenseValid, driver.files?.license],
    ];
    for (const [type, number, validUntil, file] of personalDocs) {
      if (!text(number) && !dateOnly(validUntil) && !file?.url) continue;
      rows.documents.push({
        id: randomUUID(), owner_type: "driver", owner_id: id, type, number: text(number),
        valid_until: dateOnly(validUntil), file_id: fileRef(file), legacy_id: `driver:${driver.id}:${type}`,
      });
    }
  }

  // --- viaturas -------------------------------------------------------------------------------
  const vehicleIds = new Map<string, string>();
  const plates = new Set<string>();
  for (const vehicle of list("vehicles")) {
    const id = randomUUID();
    vehicleIds.set(String(vehicle.id), id);
    let plate = text(vehicle.plate);
    if (plate && plates.has(plate.toUpperCase())) {
      warnings.push(`Matrícula duplicada "${plate}" (viatura ${vehicle.id}); importada sem matrícula.`);
      plate = null;
    }
    if (plate) plates.add(plate.toUpperCase());
    rows.vehicles.push({
      id,
      brand: text(vehicle.brand) ?? "",
      model: text(vehicle.model) ?? "",
      plate,
      color: text(vehicle.color),
      year: int(vehicle.year),
      chassis: text(vehicle.chassis),
      mileage: int(vehicle.mileage),
      status: "disponivel", // recalculado abaixo
      photo_file_id: fileRef(vehicle.files?.photo),
      legacy_id: String(vehicle.id),
      created_at: isoOrNull(vehicle.createdAt) ?? now,
      _legacyStatus: vehicle.status,
    });
    const vehicleDocs: [string, unknown, Legacy | undefined][] = [
      ["livrete", vehicle.booklet, vehicle.files?.booklet],
      ["titulo_propriedade", vehicle.propertyTitle, vehicle.files?.propertyTitle],
      ["seguro", vehicle.insurancePolicy, vehicle.files?.insurancePolicy],
      ["inspecao", null, vehicle.files?.inspection],
    ];
    for (const [type, number, file] of vehicleDocs) {
      if (!text(number) && !file?.url) continue;
      rows.documents.push({
        id: randomUUID(), owner_type: "vehicle", owner_id: id, type, number: text(number),
        valid_until: null, file_id: fileRef(file), legacy_id: `vehicle:${vehicle.id}:${type}`,
      });
    }
  }

  for (const doc of list("documents")) {
    const ownerType = doc.scope === "vehicle" ? "vehicle" : doc.scope === "driver" ? "driver" : "company";
    const ownerId = ownerType === "vehicle" ? vehicleIds.get(String(doc.vehicleId))
      : ownerType === "driver" ? driverIds.get(String(doc.driverId)) : null;
    if (ownerType !== "company" && !ownerId) {
      warnings.push(`Documento "${doc.name}" (${doc.id}) sem ${ownerType === "vehicle" ? "viatura" : "motorista"} existente; ignorado.`);
      continue;
    }
    rows.documents.push({
      id: randomUUID(), owner_type: ownerType, owner_id: ownerId ?? null,
      type: DOCUMENT_TYPES[doc.name] ?? "outro", number: text(doc.number),
      valid_until: dateOnly(doc.expiresAt), file_id: fileRef(doc.file), notes: text(doc.notes),
      legacy_id: String(doc.id), created_at: isoOrNull(doc.createdAt) ?? now,
    });
  }

  // --- atribuições ----------------------------------------------------------------------------
  type PlannedAssignment = Row & { id: string; vehicle_id: string; driver_id: string; start_at: string; end_at: string | null; weekly_fee: number };
  const assignments: PlannedAssignment[] = [];
  for (const assignment of list("assignments")) {
    const vehicleId = vehicleIds.get(String(assignment.vehicleId));
    const driverId = driverIds.get(String(assignment.driverId));
    if (!vehicleId || !driverId) {
      warnings.push(`Atribuição ${assignment.id} aponta para viatura/motorista inexistente; ignorada.`);
      continue;
    }
    const startAt = isoOrNull(assignment.startAt) ?? isoOrNull(assignment.createdAt) ?? now;
    const active = assignment.status === "ativo";
    let endAt = active ? null : isoOrNull(assignment.endedAt) ?? startAt;
    if (endAt && endAt < startAt) endAt = startAt;
    assignments.push({
      id: randomUUID(),
      vehicle_id: vehicleId,
      driver_id: driverId,
      start_at: startAt,
      end_at: endAt,
      weekly_fee: money(assignment.weeklyFee) || defaultFee,
      deposit_received: money(assignment.depositReceived),
      handover: {
        mileage: int(assignment.handoverMileage),
        fuelLevel: assignment.fuelLevel ?? null,
        documents: assignment.documents ?? {},
        keysDelivered: Boolean(assignment.keysDelivered),
        gpsConfirmed: Boolean(assignment.gpsConfirmed),
      },
      status: active ? "ativa" : assignment.status === "substituida" ? "substituida" : "encerrada",
      end_reason: text(assignment.endReason),
      notes: text(assignment.notes),
      synthetic: Boolean(assignment.synthetic),
      legacy_id: String(assignment.id),
      created_at: isoOrNull(assignment.createdAt) ?? now,
    });
  }
  // Viaturas com motorista definido mas sem atribuição ativa (dados anteriores à Fase 0).
  for (const vehicle of list("vehicles")) {
    const vehicleId = vehicleIds.get(String(vehicle.id))!;
    const driverId = driverIds.get(String(vehicle.driverId));
    if (!driverId) continue;
    const exists = assignments.some((a) => a.status === "ativa" && (a.vehicle_id === vehicleId || a.driver_id === driverId));
    if (exists) continue;
    const startAt = isoOrNull(vehicle.assignedAt) ?? isoOrNull(vehicle.createdAt) ?? now;
    assignments.push({
      id: randomUUID(), vehicle_id: vehicleId, driver_id: driverId, start_at: startAt, end_at: null,
      weekly_fee: defaultFee, deposit_received: 0, handover: {}, status: "ativa", synthetic: true,
      notes: "Criada na importação: motorista definido na viatura sem atribuição.",
      legacy_id: `vehicle-driver:${vehicle.id}`, created_at: now,
    });
    warnings.push(`Viatura ${vehicle.plate || vehicle.id}: criada atribuição a partir do motorista definido na viatura (início ${startAt.slice(0, 10)}, confirme).`);
  }
  // Uma só atribuição ativa por viatura/motorista: mantém a mais recente.
  for (const key of ["vehicle_id", "driver_id"] as const) {
    const byKey = new Map<string, PlannedAssignment[]>();
    assignments.filter((a) => a.status === "ativa").forEach((a) => {
      byKey.set(a[key], [...(byKey.get(a[key]) ?? []), a]);
    });
    for (const group of byKey.values()) {
      if (group.length < 2) continue;
      group.sort((a, b) => b.start_at.localeCompare(a.start_at));
      for (const older of group.slice(1)) {
        older.status = "substituida";
        older.end_at = group[0].start_at > older.start_at ? group[0].start_at : older.start_at;
        older.end_reason = "duplicada_na_importacao";
        warnings.push(`Atribuição ${older.legacy_id} encerrada: havia outra ativa para a mesma ${key === "vehicle_id" ? "viatura" : "motorista"}.`);
      }
    }
  }
  rows.assignments.push(...assignments);

  // --- ocorrências ----------------------------------------------------------------------------
  const stopsByVehicle = new Map<string, StopPeriod[]>();
  const stopsByDriver = new Map<string, StopPeriod[]>();
  const addStop = (stop: StopPeriod, vehicleId?: string | null, driverId?: string | null) => {
    if (vehicleId) stopsByVehicle.set(vehicleId, [...(stopsByVehicle.get(vehicleId) ?? []), stop]);
    if (driverId) stopsByDriver.set(driverId, [...(stopsByDriver.get(driverId) ?? []), stop]);
  };
  const statusMap: Record<string, string> = { resolvido: "resolvida", agendado: "agendada", aberto: "em_curso", em_curso: "em_curso" };
  for (const event of list("events")) {
    const vehicleId = vehicleIds.get(String(event.vehicleId)) ?? null;
    const driverId = driverIds.get(String(event.driverId)) ?? null;
    if (!vehicleId && !driverId) {
      warnings.push(`Ocorrência ${event.id} sem viatura nem motorista existentes; ignorada.`);
      continue;
    }
    const startAt = isoOrNull(event.startDate) ?? isoOrNull(event.date) ?? isoOrNull(event.createdAt) ?? now;
    const status = statusMap[event.status] ?? "em_curso";
    let endAt = isoOrNull(event.endDate);
    if (status === "resolvida") {
      const resolvedAt = isoOrNull(event.resolvedAt);
      if (resolvedAt && (!endAt || resolvedAt < endAt)) endAt = resolvedAt;
      if (!endAt) endAt = new Date(parseInstant(startAt) + 86_400_000).toISOString();
    }
    if (endAt && endAt < startAt) endAt = startAt;
    const exempts = Boolean(event.exemptFromFee || event.immobilizeVehicle || EXEMPT_TYPES.has(event.type));
    const id = randomUUID();
    rows.incidents.push({
      id, type: text(event.type) ?? "outro", vehicle_id: vehicleId, driver_id: driverId,
      start_at: startAt, end_at: endAt, status, exempts_fee: exempts,
      immobilizes: Boolean(event.immobilizeVehicle), releases_assignment: Boolean(event.releaseAssignment),
      immobilization_applied: Boolean(event.immobilizeVehicle) && event.immobilizationApplied !== false,
      amount: money(event.amount), reported_at: isoOrNull(event.createdAt) ?? startAt,
      validated_at: isoOrNull(event.createdAt) ?? startAt, notes: text(event.notes),
      legacy_id: String(event.id), created_at: isoOrNull(event.createdAt) ?? now,
    });
    if (exempts && status !== "cancelada") addStop({ id, startAt, endAt }, vehicleId, driverId);
  }

  // Isenções de semana antigas → paragem que cobre a semana paga por esse vencimento.
  const legacyWeekOf = (dueAt: string) => addDays(weekStartOf(localDateOf(parseInstant(dueAt), rules.utcOffsetMinutes)), -7);
  for (const payment of list("payments").filter((p) => p.isExempt)) {
    const driverId = driverIds.get(String(payment.driverId)) ?? null;
    const vehicleId = vehicleIds.get(String(payment.vehicleId)) ?? null;
    if (!driverId) {
      warnings.push(`Isenção ${payment.id} sem motorista existente; ignorada.`);
      continue;
    }
    const week = legacyWeekOf(isoOrNull(payment.dueAt) ?? isoOrNull(payment.createdAt) ?? now);
    const startAt = new Date(localTimeToInstant(week, "00:00", rules.utcOffsetMinutes)).toISOString();
    const endAt = new Date(localTimeToInstant(addDays(week, 7), "00:00", rules.utcOffsetMinutes)).toISOString();
    const id = randomUUID();
    rows.incidents.push({
      id, type: payment.exemptReason === "doenca" ? "doenca" : payment.exemptReason === "oficina" ? "manutencao" : "isencao_semana",
      vehicle_id: vehicleId, driver_id: driverId, start_at: startAt, end_at: endAt, status: "resolvida",
      exempts_fee: true, amount: 0, reported_at: isoOrNull(payment.createdAt) ?? now,
      validated_at: isoOrNull(payment.createdAt) ?? now,
      notes: ["Importada de \"Isenção de semana\".", text(payment.notes)].filter(Boolean).join(" "),
      legacy_id: `payment-exempt:${payment.id}`, created_at: isoOrNull(payment.createdAt) ?? now,
    });
    addStop({ id, startAt, endAt }, vehicleId, driverId);
  }

  // --- despesas -------------------------------------------------------------------------------
  const batches = new Map<string, string>();
  for (const expense of list("expenses")) {
    if (expense.batchId && !batches.has(expense.batchId)) {
      const members = list("expenses").filter((item) => item.batchId === expense.batchId);
      const id = randomUUID();
      batches.set(expense.batchId, id);
      rows.expense_batches.push({
        id, mode: "por_viatura", category: text(expense.category) ?? "outro", description: text(expense.notes),
        vehicle_count: members.length, amount_per_vehicle: money(expense.amount),
        total: members.reduce((sum, item) => sum + money(item.amount), 0),
        created_at: isoOrNull(expense.createdAt) ?? now,
      });
    }
    rows.expenses.push({
      id: randomUUID(), vehicle_id: vehicleIds.get(String(expense.vehicleId)) ?? null,
      batch_id: expense.batchId ? batches.get(expense.batchId) : null,
      category: text(expense.category) ?? "outro",
      responsible: expense.responsible === "motorista" ? "motorista" : "proprietaria",
      amount: money(expense.amount), spent_on: dateOnly(expense.date) ?? now.slice(0, 10),
      supplier: text(expense.paidTo), notes: text(expense.notes), legacy_id: String(expense.id),
      created_at: isoOrNull(expense.createdAt) ?? now,
    });
  }

  // --- cobranças semanais reconstruídas -------------------------------------------------------
  type PlannedCharge = Row & { id: string; driver_id: string; due_at: string; amount: number; period_start: string | null; paid: number; settledAt: string | null };
  const charges: PlannedCharge[] = [];
  for (const assignment of assignments) {
    const stops = [
      ...(stopsByVehicle.get(assignment.vehicle_id) ?? []),
      ...(stopsByDriver.get(assignment.driver_id) ?? []),
    ].filter((stop, index, all) => all.findIndex((other) => other.id === stop.id) === index);
    const period = { startAt: assignment.start_at, endAt: assignment.end_at, weeklyFee: assignment.weekly_fee };
    for (const week of billableWeeks(period, now, rules)) {
      const calc = calculateWeeklyCharge(week, period, stops, rules);
      if (!calc.coveredDays.length) continue;
      charges.push({
        id: randomUUID(), kind: "semanal", driver_id: assignment.driver_id, vehicle_id: assignment.vehicle_id,
        assignment_id: assignment.id, period_start: calc.periodStart, period_end: calc.periodEnd,
        due_at: calc.dueAt, amount: calc.amount, status: "aberta",
        calculation: {
          weeklyFee: calc.weeklyFee, workingDays: calc.workingDays, coveredDays: calc.coveredDays,
          stoppedDays: calc.stoppedDays, chargedDays: calc.chargedDays, dailyRate: calc.dailyRate,
          incidentIds: calc.stopIds,
        },
        paid: 0, settledAt: null,
      });
    }
  }

  // --- pagamentos e alocação ------------------------------------------------------------------
  const realPayments = list("payments")
    .filter((p) => !p.isExempt && money(p.amount) + money(p.penaltyPaid) > 0)
    .sort((a, b) => String(a.paidAt || a.createdAt).localeCompare(String(b.paidAt || b.createdAt)));
  for (const payment of realPayments) {
    const driverId = driverIds.get(String(payment.driverId));
    if (!driverId) {
      warnings.push(`Pagamento ${payment.id} (${money(payment.amount)} Kz) sem motorista existente; ignorado.`);
      continue;
    }
    const receivedAt = isoOrNull(payment.paidAt) ?? isoOrNull(payment.createdAt) ?? now;
    const feeAmount = money(payment.amount);
    const penaltyAmount = money(payment.penaltyPaid);
    const paymentId = randomUUID();
    rows.payments.push({
      id: paymentId, driver_id: driverId, amount: feeAmount + penaltyAmount, received_at: receivedAt,
      method: "outro", reference: text(payment.proof), proof_file_id: fileRef(payment.files?.proof),
      notes: [text(payment.justification), text(payment.notes)].filter(Boolean).join(" · ") || null,
      legacy_id: String(payment.id), created_at: isoOrNull(payment.createdAt) ?? now,
    });

    let credit = 0;
    if (feeAmount > 0) {
      const open = charges
        .filter((c) => c.driver_id === driverId && c.amount - c.paid > 0)
        .map((c) => ({ id: c.id, dueAt: c.due_at, outstanding: c.amount - c.paid }));
      const result = allocatePayment(feeAmount, open);
      for (const allocation of result.allocations) {
        const charge = charges.find((c) => c.id === allocation.chargeId)!;
        charge.paid += allocation.amount;
        if (charge.paid >= charge.amount) charge.settledAt = receivedAt;
        rows.payment_allocations.push({ payment_id: paymentId, charge_id: charge.id, amount: allocation.amount });
      }
      credit = result.credit;
    }
    if (penaltyAmount > 0) {
      const week = legacyWeekOf(isoOrNull(payment.dueAt) ?? receivedAt);
      const related = charges.find((c) => c.driver_id === driverId && c.period_start === week);
      const penaltyId = randomUUID();
      charges.push({
        id: penaltyId, kind: "penalidade_atraso", driver_id: driverId, vehicle_id: related?.vehicle_id ?? null,
        assignment_id: related?.assignment_id ?? null, period_start: related ? week : null,
        period_end: related ? addDays(week, 6) : null, due_at: receivedAt, amount: penaltyAmount,
        status: "aberta", related_charge_id: related?.id ?? null,
        description: "Penalidade de atraso paga (importada).", calculation: null,
        paid: penaltyAmount, settledAt: receivedAt,
      });
      rows.payment_allocations.push({ payment_id: paymentId, charge_id: penaltyId, amount: penaltyAmount });
    }
    if (credit > 0) {
      warnings.push(`Pagamento ${payment.id} de ${driverNames.get(driverId)}: ${credit} Kz acima das cobranças existentes (fica como crédito).`);
    }
  }

  for (const charge of charges) {
    charge.status = chargeStatus(charge.amount, charge.paid);
    rows.charges.push(Object.fromEntries(Object.entries(charge).filter(([key]) => !["paid", "settledAt"].includes(key))));
  }

  // --- estado das viaturas --------------------------------------------------------------------
  for (const vehicle of rows.vehicles) {
    const legacyStatus = vehicle._legacyStatus;
    delete vehicle._legacyStatus;
    const active = assignments.some((a) => a.status === "ativa" && a.vehicle_id === vehicle.id);
    vehicle.status = ["imobilizado", "manutencao", "inativo"].includes(String(legacyStatus))
      ? "imobilizada"
      : active ? "em_servico" : "disponivel";
  }

  // --- relatório ------------------------------------------------------------------------------
  const drivers: DriverSummary[] = rows.drivers.map((driver) => {
    const id = String(driver.id);
    const own = charges.filter((c) => c.driver_id === id);
    const weekly = own.filter((c) => c.kind === "semanal");
    const paid = rows.payments.filter((p) => p.driver_id === id).reduce((sum, p) => sum + Number(p.amount), 0);
    const totalCharged = own.reduce((sum, c) => sum + c.amount, 0);
    const uncollectedPenalties = weekly.reduce((sum, c) => {
      const recorded = own.some((p) => p.kind === "penalidade_atraso" && p.related_charge_id === c.id);
      return recorded ? sum : sum + latePenalty({ amount: c.amount, dueAt: c.due_at }, c.settledAt, now, rules).amount;
    }, 0);
    return {
      driverId: id,
      name: String(driver.name),
      weeksCharged: weekly.length,
      totalCharged,
      totalPaid: paid,
      balance: totalCharged - paid,
      openWeeks: weekly.filter((c) => c.paid < c.amount).map((c) => String(c.period_start)),
      uncollectedPenalties,
    };
  });

  return {
    rows,
    report: {
      generatedAt: now,
      counts: Object.fromEntries(Object.entries(rows).map(([key, value]) => [key, value.length])),
      warnings,
      drivers,
    },
  };
}
