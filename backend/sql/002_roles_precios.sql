BEGIN;
CREATE TABLE IF NOT EXISTS app_users (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 name VARCHAR(120) NOT NULL,
 email VARCHAR(255) NOT NULL UNIQUE,
 password_hash TEXT NOT NULL,
 role VARCHAR(20) NOT NULL CHECK (role IN ('admin','seller')),
 is_active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS auth_sessions (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 user_id BIGINT NOT NULL REFERENCES app_users(id),
 token_hash CHAR(64) NOT NULL UNIQUE,
 expires_at TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions(expires_at);
CREATE TABLE IF NOT EXISTS price_requests (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 product_id BIGINT NOT NULL REFERENCES products(id),
 requested_by BIGINT NOT NULL REFERENCES app_users(id),
 old_price_bob NUMERIC(12,2) NOT NULL CHECK (old_price_bob >= 0),
 new_price_bob NUMERIC(12,2) NOT NULL CHECK (new_price_bob >= 0),
 status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
 reviewed_by BIGINT REFERENCES app_users(id),
 reviewed_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK (new_price_bob <> old_price_bob)
);
CREATE INDEX IF NOT EXISTS idx_price_requests_status ON price_requests(status,created_at DESC);
CREATE TABLE IF NOT EXISTS price_history (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 product_id BIGINT NOT NULL REFERENCES products(id),
 old_price_bob NUMERIC(12,2) NOT NULL,
 new_price_bob NUMERIC(12,2) NOT NULL,
 changed_by BIGINT NOT NULL REFERENCES app_users(id),
 request_id BIGINT UNIQUE REFERENCES price_requests(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit_events (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 user_id BIGINT REFERENCES app_users(id),
 action VARCHAR(80) NOT NULL,
 entity_type VARCHAR(60) NOT NULL,
 entity_id BIGINT,
 details JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS performed_by BIGINT REFERENCES app_users(id);
COMMIT;
