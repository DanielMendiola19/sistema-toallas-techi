BEGIN;
-- Permitir salidas de stock originadas en una venta y su anulación.
ALTER TABLE inventory_movements DROP CONSTRAINT IF EXISTS inventory_movements_movement_type_check;
ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_movement_type_check
 CHECK (movement_type IN ('initial','adjustment','sale','sale_reversal'));
CREATE TABLE cash_registers (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 name VARCHAR(120) NOT NULL UNIQUE,
 is_active BOOLEAN NOT NULL DEFAULT TRUE
);
INSERT INTO cash_registers(name) VALUES ('Caja principal') ON CONFLICT (name) DO NOTHING;
CREATE TABLE cash_sessions (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 cash_register_id BIGINT NOT NULL REFERENCES cash_registers(id),
 opened_by BIGINT NOT NULL REFERENCES app_users(id),
 opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 closing_limit_at TIMESTAMPTZ NOT NULL,
 closed_at TIMESTAMPTZ,
 closed_by BIGINT REFERENCES app_users(id),
 opening_cash_bob NUMERIC(12,2) NOT NULL CHECK (opening_cash_bob >= 0),
 counted_cash_bob NUMERIC(12,2) CHECK(counted_cash_bob>=0),
 status VARCHAR(12) NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
 CHECK (closing_limit_at > opened_at)
);
CREATE UNIQUE INDEX one_open_cash_session ON cash_sessions(cash_register_id) WHERE status='open';
CREATE TABLE sales (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 request_key UUID NOT NULL UNIQUE,
 cash_session_id BIGINT NOT NULL REFERENCES cash_sessions(id),
 seller_id BIGINT NOT NULL REFERENCES app_users(id),
 total_bob NUMERIC(12,2) NOT NULL CHECK(total_bob>0),
 status VARCHAR(12) NOT NULL DEFAULT 'completed' CHECK(status IN ('completed','voided')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 voided_at TIMESTAMPTZ,
 voided_by BIGINT REFERENCES app_users(id),
 void_reason TEXT
);
CREATE TABLE sale_items (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 sale_id BIGINT NOT NULL REFERENCES sales(id),
 product_id BIGINT NOT NULL REFERENCES products(id),
 product_code VARCHAR(50) NOT NULL,
 product_name VARCHAR(200) NOT NULL,
 quantity INTEGER NOT NULL CHECK(quantity>0),
 unit_price_bob NUMERIC(12,2) NOT NULL CHECK(unit_price_bob>=0),
 subtotal_bob NUMERIC(12,2) NOT NULL CHECK(subtotal_bob>=0)
);
CREATE TABLE sale_payments (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 sale_id BIGINT NOT NULL REFERENCES sales(id),
 method VARCHAR(15) NOT NULL CHECK(method IN ('cash','qr','transfer','other')),
 amount_bob NUMERIC(12,2) NOT NULL CHECK(amount_bob>0),
 reference VARCHAR(120)
);
CREATE INDEX sales_created_idx ON sales(created_at DESC);
CREATE INDEX sales_session_idx ON sales(cash_session_id);
CREATE INDEX sale_items_product_idx ON sale_items(product_id);
CREATE INDEX sale_payments_sale_idx ON sale_payments(sale_id);
COMMIT;
