CREATE TABLE IF NOT EXISTS users (
  email               TEXT PRIMARY KEY,
  free_reading_used   BOOLEAN NOT NULL DEFAULT FALSE,
  credits             INTEGER NOT NULL DEFAULT 0,
  membership_active   BOOLEAN NOT NULL DEFAULT FALSE,
  stripe_customer_id  TEXT,
  stripe_subscription_id TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS otp_codes (
  email       TEXT PRIMARY KEY,
  code_hash   TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_users_stripe_subscription ON users (stripe_subscription_id);
