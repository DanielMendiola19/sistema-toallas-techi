import { Router } from 'express';
import { pool } from './database.js';
import { requireAuth, requireAdmin } from './auth.js';

export const inventoryRouter = Router();
inventoryRouter.use(requireAuth, requireAdmin);
const isId = (v: unknown): v is string => typeof v === 'string' && /^\d+$/.test(v);

// Historial paginado; no limita el universo de productos al listado visible en React.
inventoryRouter.get('/movements', async (req,res,next) => {
 try {
  const page = Math.max(1, Math.min(100000, Number.parseInt(String(req.query.page ?? '1'),10) || 1));
  const productId = req.query.product_id;
  if (productId !== undefined && !isId(productId)) {res.status(422).json({error:'Producto inválido'});return;}
  const conditions = productId ? 'WHERE m.product_id=$1' : '';
  const params = productId ? [productId] : [];
  const count = await pool.query(`SELECT COUNT(*)::int AS total FROM inventory_movements m ${conditions}`,params);
  const total = Number(count.rows[0].total);
  const data = await pool.query(`SELECT m.id,m.product_id,p.code AS product_code,p.name AS product_name,
    m.movement_type,m.quantity_delta,m.stock_before,m.stock_after,m.reason,m.created_at,
    u.name AS performed_by_name
    FROM inventory_movements m JOIN products p ON p.id=m.product_id
    LEFT JOIN app_users u ON u.id=m.performed_by
    ${conditions} ORDER BY m.created_at DESC,m.id DESC LIMIT 20 OFFSET $${params.length+1}`,
    [...params,(page-1)*20]);
  res.json({items:data.rows,page,total,pages:Math.max(1,Math.ceil(total/20)),pageSize:20});
 } catch(error){next(error);}
});

inventoryRouter.post('/movements', async (req,res,next)=>{
 const {product_id,type,quantity,reason}=req.body ?? {};
 if (!isId(product_id) || !['entry','loss','count'].includes(type) || !Number.isSafeInteger(quantity) || quantity < 0 || quantity > 2147483647 ||
   (type !== 'count' && quantity === 0) || (reason != null && (typeof reason !== 'string' || reason.trim().length > 500))) {
  res.status(422).json({error:'Selecciona un producto, tipo y cantidad válidos (motivo opcional de hasta 500 caracteres)'});return;
 }
 const client=await pool.connect();
 try {
  await client.query('BEGIN');
  const found=await client.query('SELECT id,stock,name FROM products WHERE id=$1 AND is_active=true FOR UPDATE',[product_id]);
  if(!found.rowCount){await client.query('ROLLBACK');res.status(404).json({error:'Producto no encontrado o inactivo'});return;}
  const before=Number(found.rows[0].stock);
  const delta=type==='entry'?quantity:type==='loss'?-quantity:quantity-before;
  const after=before+delta;
  if (after<0 || after>2147483647) {await client.query('ROLLBACK');res.status(409).json({error:'El movimiento dejaría un stock inválido'});return;}
  if (delta===0) {await client.query('ROLLBACK');res.status(422).json({error:'El conteo coincide con el stock actual; no hay cambios que registrar'});return;}
  const movementType=type==='count'?'count':type;
  await client.query('UPDATE products SET stock=$1,updated_at=now() WHERE id=$2',[after,product_id]);
  const saved=await client.query(`INSERT INTO inventory_movements(product_id,movement_type,quantity_delta,stock_before,stock_after,reason,performed_by)
     VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,stock_before,stock_after,quantity_delta`,
    [product_id,movementType,delta,before,after,(reason ?? '').trim(),req.currentUser!.id]);
  await client.query('COMMIT');
  res.status(201).json(saved.rows[0]);
 }catch(error){await client.query('ROLLBACK');next(error);}finally{client.release();}
});
