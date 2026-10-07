-- Fase 2: modelo normalizado (ver docs/PLANO-APP-FLUTTER.md §3.2).
-- Valores monetários em kwanzas inteiros (bigint). Instantes em timestamptz; dias locais em date.
-- legacy_id guarda o id do registo no estado JSON antigo (importação idempotente).

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text UNIQUE,
  email text UNIQUE,
  role text NOT NULL CHECK (role IN ('admin', 'gestor', 'motorista')),
  password_hash text,
  pin_hash text,
  driver_id uuid,
  active boolean NOT NULL DEFAULT true,
  activation_code_hash text,
  activation_expires_at timestamptz,
  failed_logins integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (role <> 'motorista' OR driver_id IS NOT NULL),
  CHECK (phone IS NOT NULL OR email IS NOT NULL)
);

CREATE TABLE refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  replaced_by uuid,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);

CREATE TABLE files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_name text NOT NULL,
  storage_key text NOT NULL UNIQUE,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  category text NOT NULL DEFAULT 'documento',
  uploaded_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand text NOT NULL DEFAULT '',
  model text NOT NULL DEFAULT '',
  plate text,
  color text,
  year integer CHECK (year IS NULL OR year BETWEEN 1950 AND 2100),
  chassis text,
  mileage integer CHECK (mileage IS NULL OR mileage >= 0),
  -- Derivado das atribuições e ocorrências; só 'abatida' é definido à mão.
  status text NOT NULL DEFAULT 'disponivel' CHECK (status IN ('disponivel', 'em_servico', 'imobilizada', 'abatida')),
  photo_file_id uuid REFERENCES files (id),
  legacy_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX vehicles_plate_unique ON vehicles (upper(plate)) WHERE plate IS NOT NULL AND plate <> '' AND deleted_at IS NULL;

CREATE TABLE drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text,
  bi text,
  nif text,
  license_number text,
  license_category text,
  address text,
  latitude double precision,
  longitude double precision,
  deposit bigint NOT NULL DEFAULT 0 CHECK (deposit >= 0),
  contract_start date,
  photo_file_id uuid REFERENCES files (id),
  legacy_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

ALTER TABLE users ADD CONSTRAINT users_driver_fk FOREIGN KEY (driver_id) REFERENCES drivers (id);
CREATE UNIQUE INDEX users_driver_unique ON users (driver_id) WHERE driver_id IS NOT NULL;

CREATE TABLE driver_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES drivers (id) ON DELETE CASCADE,
  name text NOT NULL,
  relation text,
  phone text,
  position smallint NOT NULL DEFAULT 0
);

CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type text NOT NULL CHECK (owner_type IN ('vehicle', 'driver', 'company')),
  owner_id uuid,
  type text NOT NULL,
  number text,
  issued_on date,
  valid_until date,
  file_id uuid REFERENCES files (id),
  notes text,
  legacy_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK ((owner_type = 'company') = (owner_id IS NULL))
);
CREATE INDEX documents_owner_idx ON documents (owner_type, owner_id);
CREATE INDEX documents_valid_until_idx ON documents (valid_until) WHERE deleted_at IS NULL;

CREATE TABLE assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles (id),
  driver_id uuid NOT NULL REFERENCES drivers (id),
  start_at timestamptz NOT NULL,
  end_at timestamptz,
  weekly_fee bigint NOT NULL CHECK (weekly_fee >= 0),
  deposit_received bigint NOT NULL DEFAULT 0 CHECK (deposit_received >= 0),
  handover jsonb NOT NULL DEFAULT '{}'::jsonb,
  return_info jsonb,
  status text NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa', 'encerrada', 'substituida', 'rescindida')),
  end_reason text,
  notes text,
  synthetic boolean NOT NULL DEFAULT false,
  legacy_id text UNIQUE,
  created_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_at IS NULL OR end_at >= start_at),
  CHECK ((status = 'ativa') = (end_at IS NULL))
);
-- Uma única atribuição ativa por viatura e por motorista.
CREATE UNIQUE INDEX assignments_active_vehicle ON assignments (vehicle_id) WHERE status = 'ativa';
CREATE UNIQUE INDEX assignments_active_driver ON assignments (driver_id) WHERE status = 'ativa';
CREATE INDEX assignments_driver_idx ON assignments (driver_id, start_at);

CREATE TABLE incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  vehicle_id uuid REFERENCES vehicles (id),
  driver_id uuid REFERENCES drivers (id),
  start_at timestamptz NOT NULL,
  end_at timestamptz,
  status text NOT NULL CHECK (status IN ('por_validar', 'agendada', 'em_curso', 'resolvida', 'cancelada')),
  -- Conta como dias parados no cálculo da cobrança (só depois de validada).
  exempts_fee boolean NOT NULL DEFAULT false,
  immobilizes boolean NOT NULL DEFAULT false,
  releases_assignment boolean NOT NULL DEFAULT false,
  immobilization_applied boolean NOT NULL DEFAULT false,
  amount bigint NOT NULL DEFAULT 0 CHECK (amount >= 0),
  reported_by uuid REFERENCES users (id),
  reported_at timestamptz NOT NULL DEFAULT now(),
  validated_by uuid REFERENCES users (id),
  validated_at timestamptz,
  latitude double precision,
  longitude double precision,
  notes text,
  legacy_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_at IS NULL OR end_at >= start_at),
  CHECK (vehicle_id IS NOT NULL OR driver_id IS NOT NULL)
);
CREATE INDEX incidents_vehicle_idx ON incidents (vehicle_id, start_at);
CREATE INDEX incidents_driver_idx ON incidents (driver_id, start_at);

CREATE TABLE incident_attachments (
  incident_id uuid NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
  file_id uuid NOT NULL REFERENCES files (id),
  PRIMARY KEY (incident_id, file_id)
);

CREATE TABLE charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN (
    'semanal', 'penalidade_atraso', 'multa_fora_horario', 'multa_nao_restituicao',
    'franquia_sinistro', 'multa_conduta', 'ajuste', 'credito'
  )),
  driver_id uuid NOT NULL REFERENCES drivers (id),
  vehicle_id uuid REFERENCES vehicles (id),
  assignment_id uuid REFERENCES assignments (id),
  period_start date,
  period_end date,
  due_at timestamptz NOT NULL,
  -- Só 'credito' pode ser negativo (devolve dinheiro ao motorista).
  amount bigint NOT NULL CHECK (amount >= 0 OR kind = 'credito'),
  status text NOT NULL CHECK (status IN ('aberta', 'parcial', 'paga', 'isenta', 'anulada')),
  -- Detalhe do cálculo (dias cobertos, parados, taxa diária, ocorrências) para mostrar ao motorista.
  calculation jsonb,
  related_charge_id uuid REFERENCES charges (id),
  incident_id uuid REFERENCES incidents (id),
  description text,
  void_reason text,
  voided_by uuid REFERENCES users (id),
  voided_at timestamptz,
  legacy_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'semanal' OR (assignment_id IS NOT NULL AND period_start IS NOT NULL AND period_end IS NOT NULL)),
  CHECK ((status = 'anulada') = (voided_at IS NOT NULL))
);
CREATE UNIQUE INDEX charges_weekly_unique ON charges (assignment_id, period_start) WHERE kind = 'semanal' AND status <> 'anulada';
CREATE UNIQUE INDEX charges_late_penalty_unique ON charges (related_charge_id) WHERE kind = 'penalidade_atraso' AND status <> 'anulada';
CREATE INDEX charges_driver_idx ON charges (driver_id, due_at);
CREATE INDEX charges_open_idx ON charges (due_at) WHERE status IN ('aberta', 'parcial');

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES drivers (id),
  amount bigint NOT NULL CHECK (amount > 0),
  received_at timestamptz NOT NULL,
  method text NOT NULL DEFAULT 'numerario' CHECK (method IN ('numerario', 'transferencia', 'multicaixa', 'deposito', 'outro')),
  reference text,
  proof_file_id uuid REFERENCES files (id),
  notes text,
  -- Idempotência das escritas offline da app.
  client_id uuid UNIQUE,
  recorded_by uuid REFERENCES users (id),
  void_reason text,
  voided_by uuid REFERENCES users (id),
  voided_at timestamptz,
  legacy_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_driver_idx ON payments (driver_id, received_at);

CREATE TABLE payment_allocations (
  payment_id uuid NOT NULL REFERENCES payments (id) ON DELETE CASCADE,
  charge_id uuid NOT NULL REFERENCES charges (id),
  amount bigint NOT NULL CHECK (amount > 0),
  PRIMARY KEY (payment_id, charge_id)
);
CREATE INDEX payment_allocations_charge_idx ON payment_allocations (charge_id);

-- Comprovativo enviado pelo motorista; só vira pagamento quando o gestor confirma.
CREATE TABLE payment_declarations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES drivers (id),
  amount bigint NOT NULL CHECK (amount > 0),
  paid_at timestamptz NOT NULL,
  method text NOT NULL DEFAULT 'transferencia',
  reference text,
  proof_file_id uuid REFERENCES files (id),
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'confirmada', 'rejeitada')),
  rejection_reason text,
  payment_id uuid REFERENCES payments (id),
  client_id uuid UNIQUE,
  submitted_by uuid REFERENCES users (id),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES users (id),
  reviewed_at timestamptz
);
CREATE INDEX payment_declarations_pending_idx ON payment_declarations (submitted_at) WHERE status = 'pendente';

CREATE TABLE expense_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode text NOT NULL CHECK (mode IN ('por_viatura', 'dividir_total')),
  category text NOT NULL,
  description text,
  vehicle_count integer NOT NULL CHECK (vehicle_count > 0),
  amount_per_vehicle bigint NOT NULL CHECK (amount_per_vehicle >= 0),
  total bigint NOT NULL CHECK (total >= 0),
  created_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid REFERENCES vehicles (id),
  batch_id uuid REFERENCES expense_batches (id),
  category text NOT NULL,
  responsible text NOT NULL CHECK (responsible IN ('proprietaria', 'motorista')),
  amount bigint NOT NULL CHECK (amount >= 0),
  spent_on date NOT NULL,
  supplier text,
  receipt_file_id uuid REFERENCES files (id),
  notes text,
  client_id uuid UNIQUE,
  created_by uuid REFERENCES users (id),
  legacy_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX expenses_vehicle_idx ON expenses (vehicle_id, spent_on);

-- Regras do contrato com histórico: cada versão vale a partir de effective_from.
CREATE TABLE contract_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  effective_from date NOT NULL UNIQUE,
  weekly_fee bigint NOT NULL CHECK (weekly_fee >= 0),
  rules jsonb NOT NULL,
  created_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_by uuid REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES users (id),
  entity text NOT NULL,
  entity_id text NOT NULL,
  action text NOT NULL,
  diff jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_entity_idx ON audit_log (entity, entity_id, created_at DESC);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_unread_idx ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users', 'vehicles', 'drivers', 'documents', 'assignments', 'incidents', 'charges', 'expenses'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I_set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
  END LOOP;
END $$;

INSERT INTO contract_rules (effective_from, weekly_fee, rules) VALUES (
  '2000-01-01',
  130000,
  '{
    "workingWeekdays": [2, 3, 4, 5, 6, 7],
    "operatingHours": {"2": ["05:00", "22:00"], "3": ["05:00", "22:00"], "4": ["05:00", "22:00"],
                       "5": ["05:00", "24:00"], "6": ["05:00", "24:00"], "7": ["05:00", "24:00"]},
    "deliveryHour": "12:00",
    "penaltyLate24": 5000,
    "penaltyLate72": 15000,
    "fineOffHours": 50000,
    "returnDelayDaily": 30000,
    "deductibleLimit": 80000,
    "minStopHours": 4,
    "utcOffsetMinutes": 60
  }'::jsonb
);
