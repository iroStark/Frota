-- Avisos: um por utilizador e por chave (o mesmo aviso nunca se repete) e envio push opcional.
ALTER TABLE notifications ADD COLUMN dedupe_key text;
ALTER TABLE notifications ADD COLUMN pushed_at timestamptz;
CREATE UNIQUE INDEX notifications_dedupe_idx ON notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX notifications_push_idx ON notifications (created_at) WHERE pushed_at IS NULL;

CREATE TABLE device_tokens (
  token text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('ios', 'android')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX device_tokens_user_idx ON device_tokens (user_id);
