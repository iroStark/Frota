// Regras puras de valores e prazos de pagamento.
import { HOUR_MS, parseInstant } from "./time.ts";

/**
 * Divide um total inteiro (kwanzas) por N viaturas sem perder nem criar kwanzas:
 * os primeiros recebem +1 até esgotar o resto. Ex.: 100 000 / 3 → 33 334, 33 333, 33 333.
 */
export function splitTotal(total: number, parts: number): number[] {
  if (!Number.isInteger(total) || total < 0) throw new Error("O total tem de ser um inteiro não negativo.");
  if (!Number.isInteger(parts) || parts <= 0) throw new Error("É preciso pelo menos uma viatura.");
  const base = Math.floor(total / parts);
  const remainder = total - base * parts;
  return Array.from({ length: parts }, (_, index) => base + (index < remainder ? 1 : 0));
}

/**
 * Momento que conta para o prazo de um pagamento declarado pelo motorista.
 * O contrato exige o comprovativo até 12h depois do pagamento: dentro desse prazo conta a hora
 * do pagamento; fora dele conta a hora em que o comprovativo foi enviado.
 */
export function effectivePaymentTime(paidAt: string, submittedAt: string, graceHours = 12): string {
  const paid = parseInstant(paidAt);
  const submitted = parseInstant(submittedAt);
  const effective = paid <= submitted && submitted - paid <= graceHours * HOUR_MS ? paid : submitted;
  return new Date(effective).toISOString();
}
