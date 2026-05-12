CREATE TABLE IF NOT EXISTS app_state (
  id text PRIMARY KEY,
  payload jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_state_audit (
  id bigserial PRIMARY KEY,
  state_id text NOT NULL,
  payload jsonb NOT NULL,
  source text NOT NULL DEFAULT 'api',
  saved_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS uploads (
  id uuid PRIMARY KEY,
  original_name text NOT NULL,
  stored_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  category text NOT NULL DEFAULT 'documento',
  url text NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS app_state_payload_gin_idx ON app_state USING gin (payload);
CREATE INDEX IF NOT EXISTS app_state_audit_state_saved_idx ON app_state_audit (state_id, saved_at DESC);
CREATE INDEX IF NOT EXISTS uploads_uploaded_at_idx ON uploads (uploaded_at DESC);
CREATE INDEX IF NOT EXISTS uploads_category_idx ON uploads (category);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS app_state_set_updated_at ON app_state;

CREATE TRIGGER app_state_set_updated_at
BEFORE UPDATE ON app_state
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
