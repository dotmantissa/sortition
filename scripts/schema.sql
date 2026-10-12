CREATE TABLE IF NOT EXISTS operators (
  id text PRIMARY KEY, beneficiary text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS questions (
  id text PRIMARY KEY, owner_id text NOT NULL REFERENCES operators(id), specification jsonb NOT NULL,
  beneficiary text NOT NULL, fee numeric(78,0) NOT NULL DEFAULT 0, base_bond numeric(78,0) NOT NULL DEFAULT 1,
  criteria_hash text, docket_address text UNIQUE, status text NOT NULL DEFAULT 'registering',
  docket jsonb, escrow jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS operations (
  id uuid PRIMARY KEY, question_id text NOT NULL REFERENCES questions(id), owner_id text NOT NULL REFERENCES operators(id),
  kind text NOT NULL, payload jsonb NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'queued',
  tx_hash text, error text, idempotency_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(owner_id,idempotency_key)
);
DROP INDEX IF EXISTS operation_active_question;
CREATE UNIQUE INDEX operation_active_question ON operations(question_id) WHERE status IN ('queued','submitted','submitting','needs_review') AND kind NOT IN ('protocol_appeal','confirm_payment','restore_payment','open_round','prepare_hearing');
CREATE TABLE IF NOT EXISTS receipts (
  tx_hash text PRIMARY KEY, question_id text NOT NULL REFERENCES questions(id), kind text NOT NULL, receipt jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY, owner_id text NOT NULL REFERENCES operators(id), key_hash text UNIQUE NOT NULL, prefix text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz
);
CREATE TABLE IF NOT EXISTS webhooks (
  question_id text PRIMARY KEY REFERENCES questions(id), url text NOT NULL, secret_ciphertext text NOT NULL
);
CREATE TABLE IF NOT EXISTS deliveries (
  id uuid PRIMARY KEY, question_id text NOT NULL REFERENCES questions(id), event_key text UNIQUE NOT NULL,
  payload jsonb NOT NULL, status text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(), delivered_at timestamptz
);
CREATE TABLE IF NOT EXISTS worker_lock (
  id integer PRIMARY KEY CHECK(id=1), lease_until timestamptz NOT NULL, token uuid NOT NULL
);
CREATE INDEX IF NOT EXISTS questions_created ON questions(created_at DESC);
CREATE INDEX IF NOT EXISTS operations_status ON operations(status,created_at);
ALTER TABLE questions ADD COLUMN IF NOT EXISTS registry_address text;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS vault_address text;
ALTER TABLE operations ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE operations ADD COLUMN IF NOT EXISTS poll_failures integer NOT NULL DEFAULT 0;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS next_index_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS operations_due ON operations(next_attempt_at) WHERE status IN ('queued','submitted');
CREATE TABLE IF NOT EXISTS sponsorships (
  operation_id uuid PRIMARY KEY REFERENCES operations(id), owner_id text NOT NULL REFERENCES operators(id),
  amount numeric(78,0) NOT NULL CHECK(amount>=0), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sponsorships_created ON sponsorships(created_at);
CREATE TABLE IF NOT EXISTS reference_receivers (
  question_id text PRIMARY KEY REFERENCES questions(id), venue text NOT NULL, market_id text NOT NULL,
  criteria_hash text NOT NULL, docket_address text NOT NULL, network text NOT NULL,
  secret_ciphertext text NOT NULL
);
CREATE TABLE IF NOT EXISTS reference_settlements (
  question_id text PRIMARY KEY REFERENCES reference_receivers(question_id), event_id text UNIQUE NOT NULL,
  outcome text NOT NULL CHECK(outcome IN ('YES','NO','UNRESOLVABLE')), action text NOT NULL,
  body_hash text NOT NULL, received_at timestamptz NOT NULL DEFAULT now()
);
