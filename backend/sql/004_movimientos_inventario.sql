BEGIN;
-- Compatible con 001_inventario.sql, 002_roles_precios.sql y 003_ventas.sql.
ALTER TABLE inventory_movements DROP CONSTRAINT IF EXISTS inventory_movements_movement_type_check;
ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_movement_type_check
CHECK (movement_type IN ('initial','adjustment','sale','sale_reversal','entry','loss','count'));
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS performed_by BIGINT REFERENCES app_users(id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_recent ON inventory_movements(created_at DESC, id DESC);
COMMIT;
