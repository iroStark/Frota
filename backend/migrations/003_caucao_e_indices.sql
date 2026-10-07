-- A caução pode ser usada no acerto da devolução (pagamento com método 'caucao').
ALTER TABLE payments DROP CONSTRAINT payments_method_check;
ALTER TABLE payments ADD CONSTRAINT payments_method_check
  CHECK (method IN ('numerario', 'transferencia', 'multicaixa', 'deposito', 'caucao', 'outro'));

CREATE INDEX IF NOT EXISTS incidents_to_validate_idx ON incidents (reported_at) WHERE validated_at IS NULL AND status = 'por_validar';
CREATE INDEX IF NOT EXISTS expenses_spent_on_idx ON expenses (spent_on) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS payments_received_idx ON payments (received_at) WHERE voided_at IS NULL;
