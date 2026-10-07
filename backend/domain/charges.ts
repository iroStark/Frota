// Motor de cobranças semanais (regras decididas a 07-10-2026, ver docs/PLANO-APP-FLUTTER.md §3.4):
// - a entrega de segunda paga a semana (segunda a domingo) que terminou;
// - o valor é proporcional aos dias trabalhados; isenções só por dias parados;
// - atraso > 72h gera alerta (sem rescisão automática).
// Funções puras: sem acesso a base de dados nem ao relógio (o "agora" é sempre passado).

import {

  HOUR_MS,
  type LocalDate,
  addDays,
  isoWeekday,
  localDateOf,
  localTimeToInstant,
  overlapMs,
  parseInstant,
  weekDays,
  weekStartOf,
} from "./time.ts";

export type ContractRules = {
  /** Dias ISO (1 = segunda … 7 = domingo) em que a viatura circula. */
  workingWeekdays: number[];
  /** Horário de circulação por dia ISO, ["HH:MM", "HH:MM"] ("24:00" = meia-noite). */
  operatingHours: Record<number, [string, string]>;
  /** Hora limite da entrega na segunda-feira seguinte à semana. */
  deliveryHour: string;
  penaltyLate24: number;
  penaltyLate72: number;
  /** Horas mínimas de paragem, dentro do horário de circulação, para o dia contar como parado. */
  minStopHours: number;
  utcOffsetMinutes: number;
};

export const DEFAULT_RULES: ContractRules = {
  workingWeekdays: [2, 3, 4, 5, 6, 7],
  operatingHours: {
    2: ["05:00", "22:00"],
    3: ["05:00", "22:00"],
    4: ["05:00", "22:00"],
    5: ["05:00", "24:00"],
    6: ["05:00", "24:00"],
    7: ["05:00", "24:00"],
  },
  deliveryHour: "12:00",
  penaltyLate24: 5000,
  penaltyLate72: 15000,
  minStopHours: 4,
  utcOffsetMinutes: 60,
};

export type AssignmentPeriod = {
  startAt: string;
  /** Momento da devolução; o dia da devolução não é cobrado. */
  endAt?: string | null;
  weeklyFee: number;
};

/** Período em que a viatura esteve parada por motivo isentável (ocorrência validada). */
export type StopPeriod = {
  id?: string;
  startAt: string;
  /** Sem fim = ainda parada. */
  endAt?: string | null;
};

export type WeeklyChargeCalculation = {
  periodStart: LocalDate;
  periodEnd: LocalDate;
  dueAt: string;
  weeklyFee: number;
  workingDays: number;
  coveredDays: LocalDate[];
  stoppedDays: LocalDate[];
  chargedDays: number;
  dailyRate: number;
  amount: number;
  stopIds: string[];
};

/**
 * Dias úteis cobertos pela atribuição: do dia de início (inclusive) ao dia da devolução (exclusive).
 */
function coveredWorkingDays(weekStart: LocalDate, assignment: AssignmentPeriod, rules: ContractRules): LocalDate[] {
  const startDay = localDateOf(parseInstant(assignment.startAt), rules.utcOffsetMinutes);
  const endDay = assignment.endAt ? localDateOf(parseInstant(assignment.endAt), rules.utcOffsetMinutes) : null;
  return weekDays(weekStart).filter((day) => (
    rules.workingWeekdays.includes(isoWeekday(day))
    && day >= startDay
    && (endDay === null || day < endDay)
  ));
}

function stopsCoveringDay(day: LocalDate, stops: StopPeriod[], rules: ContractRules): StopPeriod[] {
  const [from, to] = rules.operatingHours[isoWeekday(day)] ?? ["00:00", "24:00"];
  const windowStart = localTimeToInstant(day, from, rules.utcOffsetMinutes);
  const windowEnd = localTimeToInstant(day, to, rules.utcOffsetMinutes);
  const required = Math.min(rules.minStopHours * HOUR_MS, windowEnd - windowStart);
  return stops.filter((stop) => {
    const start = parseInstant(stop.startAt);
    const end = stop.endAt ? parseInstant(stop.endAt) : Number.POSITIVE_INFINITY;
    return overlapMs(windowStart, windowEnd, start, end) >= required;
  });
}

export function weeklyDueAt(weekStart: LocalDate, rules: ContractRules): string {
  return new Date(localTimeToInstant(addDays(weekStart, 7), rules.deliveryHour, rules.utcOffsetMinutes)).toISOString();
}

export function calculateWeeklyCharge(
  weekStart: LocalDate,
  assignment: AssignmentPeriod,
  stops: StopPeriod[],
  rules: ContractRules = DEFAULT_RULES,
): WeeklyChargeCalculation {
  if (isoWeekday(weekStart) !== 1) throw new Error(`A semana tem de começar a uma segunda-feira: ${weekStart}`);
  const workingDays = weekDays(weekStart).filter((day) => rules.workingWeekdays.includes(isoWeekday(day))).length;
  const coveredDays = coveredWorkingDays(weekStart, assignment, rules);
  const stoppedDays: LocalDate[] = [];
  const stopIds = new Set<string>();
  for (const day of coveredDays) {
    const covering = stopsCoveringDay(day, stops, rules);
    if (covering.length) {
      stoppedDays.push(day);
      covering.forEach((stop) => stop.id && stopIds.add(stop.id));
    }
  }
  const chargedDays = coveredDays.length - stoppedDays.length;
  const weeklyFee = Number(assignment.weeklyFee);
  // Semana completa = valor contratual exato; senão proporcional, arredondado ao kwanza.
  const amount = chargedDays === workingDays ? weeklyFee : Math.round((weeklyFee * chargedDays) / workingDays);
  return {
    periodStart: weekStart,
    periodEnd: addDays(weekStart, 6),
    dueAt: weeklyDueAt(weekStart, rules),
    weeklyFee,
    workingDays,
    coveredDays,
    stoppedDays,
    chargedDays,
    dailyRate: Math.round(weeklyFee / workingDays),
    amount,
    stopIds: [...stopIds],
  };
}

/**
 * Semanas já terminadas (segundas-feiras) a cobrar para uma atribuição até ao instante `now`.
 * Uma semana só é cobrável depois de domingo terminar.
 */
export function billableWeeks(assignment: AssignmentPeriod, now: string | number, rules: ContractRules = DEFAULT_RULES): LocalDate[] {
  const nowMs = parseInstant(now);
  const firstWeek = weekStartOf(localDateOf(parseInstant(assignment.startAt), rules.utcOffsetMinutes));
  const currentWeek = weekStartOf(localDateOf(nowMs, rules.utcOffsetMinutes));
  const lastDay = assignment.endAt
    ? localDateOf(parseInstant(assignment.endAt) - 1, rules.utcOffsetMinutes)
    : null;
  const lastWeek = lastDay ? weekStartOf(lastDay) : null;
  const weeks: LocalDate[] = [];
  for (let week = firstWeek; week < currentWeek; week = addDays(week, 7)) {
    if (lastWeek && week > lastWeek) break;
    weeks.push(week);
  }
  return weeks;
}

export type ChargeStatus = "aberta" | "parcial" | "paga" | "isenta";

export function chargeStatus(amount: number, paid: number): ChargeStatus {
  if (amount <= 0) return "isenta";
  if (paid >= amount) return "paga";
  if (paid > 0) return "parcial";
  return "aberta";
}

export type LatePenalty = {
  tier: "nenhuma" | "ate_24h" | "ate_72h" | "mais_72h";
  amount: number;
  delayHours: number;
  /** > 72h: o contrato prevê alerta de possível resolução. */
  breachAlert: boolean;
};

/**
 * Penalidade de atraso de uma cobrança semanal. `settledAt` é quando ficou totalmente paga
 * (ou quando o motorista enviou o comprovativo que veio a ser confirmado); `null` se ainda em dívida.
 */
export function latePenalty(
  charge: { amount: number; dueAt: string },
  settledAt: string | null,
  now: string | number,
  rules: ContractRules = DEFAULT_RULES,
): LatePenalty {
  const due = parseInstant(charge.dueAt);
  const reference = settledAt ? parseInstant(settledAt) : parseInstant(now);
  const delayHours = Math.max(0, (reference - due) / HOUR_MS);
  if (charge.amount <= 0 || delayHours === 0) {
    return { tier: "nenhuma", amount: 0, delayHours: 0, breachAlert: false };
  }
  if (delayHours <= 24) return { tier: "ate_24h", amount: rules.penaltyLate24, delayHours, breachAlert: false };
  if (delayHours <= 72) return { tier: "ate_72h", amount: rules.penaltyLate72, delayHours, breachAlert: false };
  return { tier: "mais_72h", amount: rules.penaltyLate72, delayHours, breachAlert: true };
}

export type OpenCharge = { id: string; dueAt: string; outstanding: number };
export type Allocation = { chargeId: string; amount: number };

/** Distribui um pagamento pelas cobranças em dívida, das mais antigas para as mais recentes. */
export function allocatePayment(amount: number, openCharges: OpenCharge[]): { allocations: Allocation[]; credit: number } {
  if (!(amount > 0)) throw new Error("O valor do pagamento tem de ser positivo.");
  let remaining = Math.round(amount);
  const allocations: Allocation[] = [];
  const ordered = [...openCharges]
    .filter((charge) => charge.outstanding > 0)
    .sort((a, b) => parseInstant(a.dueAt) - parseInstant(b.dueAt) || a.id.localeCompare(b.id));
  for (const charge of ordered) {
    if (remaining <= 0) break;
    const value = Math.min(remaining, charge.outstanding);
    allocations.push({ chargeId: charge.id, amount: value });
    remaining -= value;
  }
  return { allocations, credit: remaining };
}

/**
 * Recalcula uma cobrança já emitida (ex.: ocorrência registada depois). Se o já pago exceder
 * o novo valor, a diferença vira crédito do motorista (lançamento de ajuste).
 */
export function recalculateCharge(newAmount: number, paid: number): { amount: number; status: ChargeStatus; credit: number } {
  const credit = Math.max(0, paid - newAmount);
  return { amount: newAmount, status: chargeStatus(newAmount, paid - credit), credit };
}

