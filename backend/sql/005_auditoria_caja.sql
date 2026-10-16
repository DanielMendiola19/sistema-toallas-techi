BEGIN;
-- Conserva la tabla audit_events de la migración 002.
CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events(created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_actor ON audit_events(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cash_sessions_history ON cash_sessions(opened_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_audit ON inventory_movements(created_at DESC,id DESC);

CREATE OR REPLACE FUNCTION toallas_audit_inventory() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO audit_events(user_id,action,entity_type,entity_id,details)
 VALUES(NEW.performed_by,'inventory.'||NEW.movement_type,'product',NEW.product_id,
  jsonb_build_object('movement_id',NEW.id,'quantity_delta',NEW.quantity_delta,'stock_before',NEW.stock_before,'stock_after',NEW.stock_after,'reason',NEW.reason));
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_toallas_audit_inventory ON inventory_movements;
CREATE TRIGGER tr_toallas_audit_inventory AFTER INSERT ON inventory_movements FOR EACH ROW EXECUTE FUNCTION toallas_audit_inventory();

CREATE OR REPLACE FUNCTION toallas_audit_cash() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  INSERT INTO audit_events(user_id,action,entity_type,entity_id,details)
  VALUES(NEW.opened_by,'cash.opened','cash_session',NEW.id,
   jsonb_build_object('register_id',NEW.cash_register_id,'closing_limit_at',NEW.closing_limit_at));
 ELSIF OLD.status='open' AND NEW.status='closed' THEN
  INSERT INTO audit_events(user_id,action,entity_type,entity_id,details)
  VALUES(NEW.closed_by,'cash.closed','cash_session',NEW.id,
   jsonb_build_object('register_id',NEW.cash_register_id,'closed_at',NEW.closed_at));
 ELSIF NEW.closing_limit_at IS DISTINCT FROM OLD.closing_limit_at THEN
  -- La versión actual de extend no envía el ID del usuario a la BD.
  -- Deja el actor NULL en vez de atribuir incorrectamente el evento.
  INSERT INTO audit_events(user_id,action,entity_type,entity_id,details)
  VALUES(NULL,'cash.extended','cash_session',NEW.id,
   jsonb_build_object('old_limit',OLD.closing_limit_at,'new_limit',NEW.closing_limit_at));
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_toallas_audit_cash_insert ON cash_sessions;
DROP TRIGGER IF EXISTS tr_toallas_audit_cash_update ON cash_sessions;
CREATE TRIGGER tr_toallas_audit_cash_insert AFTER INSERT ON cash_sessions FOR EACH ROW EXECUTE FUNCTION toallas_audit_cash();
CREATE TRIGGER tr_toallas_audit_cash_update AFTER UPDATE OF status,closing_limit_at ON cash_sessions FOR EACH ROW EXECUTE FUNCTION toallas_audit_cash();
COMMIT;
