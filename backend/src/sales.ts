import { Router } from 'express';
import { pool } from './database.js';
import { requireAuth, requireAdmin } from './auth.js';

export const salesRouter = Router();
salesRouter.use(requireAuth);
const validId = (x: unknown) => typeof x === 'string' && /^\d+$/.test(x);
const cents = (x: unknown): number | null => {
 if (typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > 9999999999.99) return null;
 const n = Math.round(x * 100);
 return Math.abs(x * 100 - n) < 0.000001 ? n : null;
};
const jsonError = (res: any, e: unknown) => {
 console.error('Error ventas:', e);
 if ((e as {code?:string}).code === '23505') return res.status(409).json({error:'La operación ya fue registrada'});
 return res.status(500).json({error:'Error interno en ventas'});
};

salesRouter.get('/registers', async (_req,res) => {
 try {res.json((await pool.query('SELECT id,name FROM cash_registers WHERE is_active=true ORDER BY id')).rows);}
 catch(e){jsonError(res,e);}
});
salesRouter.get('/sessions/current',async(req,res)=>{
 try {
  const result=await pool.query(`SELECT s.id,s.cash_register_id,r.name AS register_name,s.opened_at,s.closing_limit_at,s.opening_cash_bob,s.status
   FROM cash_sessions s JOIN cash_registers r ON r.id=s.cash_register_id WHERE s.status='open' ORDER BY s.id`);
  res.json(result.rows);
 }catch(e){jsonError(res,e);}
});
salesRouter.post('/sessions',requireAdmin,async(req,res)=>{
 const {register_id,closing_limit_at}=req.body??{};
 const opening=0; // Sin fondo inicial solicitado: la caja comienza en Bs 0
 const closingDate=typeof closing_limit_at==='string'?new Date(closing_limit_at):null;
 if (!validId(String(register_id))||opening===null||!closingDate||!Number.isFinite(closingDate.getTime())||closingDate.getTime()<=Date.now()||closingDate.getTime()>Date.now()+48*3600000)
  return res.status(422).json({error:'Indica caja y un cierre futuro dentro de 48 horas'});
 try {
  const result=await pool.query(`INSERT INTO cash_sessions(cash_register_id,opened_by,opening_cash_bob,closing_limit_at)
   VALUES($1,$2,$3,$4) RETURNING *`,[register_id,req.currentUser!.id,opening/100,closingDate.toISOString()]);
  res.status(201).json(result.rows[0]);
 }catch(e){if((e as {code?:string}).code==='23505')return res.status(409).json({error:'La caja ya tiene una sesión abierta'});jsonError(res,e);}
});
salesRouter.patch('/sessions/:id/extend',requireAdmin,async(req,res)=>{
 const date=typeof req.body?.closing_limit_at==='string'?new Date(req.body.closing_limit_at):null;
 if(!validId(req.params.id)||!date||!Number.isFinite(date.getTime())||date.getTime()<=Date.now()||date.getTime()>Date.now()+48*3600000)
  return res.status(422).json({error:'Nueva hora de cierre inválida'});
 try {
  const result=await pool.query(`UPDATE cash_sessions SET closing_limit_at=$2 WHERE id=$1 AND status='open'
   AND closing_limit_at<$2 RETURNING *`,[req.params.id,date.toISOString()]);
  if(!result.rowCount)return res.status(409).json({error:'La sesión no está abierta o el nuevo horario no es posterior'});
  res.json(result.rows[0]);
 }catch(e){jsonError(res,e);}
});
salesRouter.post('/sessions/:id/close',requireAdmin,async(req,res)=>{
 if(!validId(req.params.id))return res.status(422).json({error:'Caja inválida'});
 const client=await pool.connect();
 try {
  await client.query('BEGIN');
  const row=await client.query(`SELECT * FROM cash_sessions WHERE id=$1 AND status='open' FOR UPDATE`,[req.params.id]);
  if(!row.rowCount){await client.query('ROLLBACK');return res.status(409).json({error:'La caja ya está cerrada'});}
  const sums=await client.query(`SELECT
    COALESCE(SUM(p.amount_bob) FILTER (WHERE p.method='cash'),0) AS cash_sales,
    COALESCE(SUM(p.amount_bob) FILTER (WHERE p.method='qr'),0) AS qr_sales,
    COALESCE(SUM(p.amount_bob) FILTER (WHERE p.method='transfer'),0) AS transfer_sales,
    COALESCE(SUM(p.amount_bob) FILTER (WHERE p.method='other'),0) AS other_sales
    FROM sale_payments p JOIN sales s ON s.id=p.sale_id
    WHERE s.cash_session_id=$1 AND s.status='completed'`,[req.params.id]);
  const expected=Number(row.rows[0].opening_cash_bob)+Number(sums.rows[0].cash_sales);
  const updated=await client.query(`UPDATE cash_sessions SET status='closed',closed_at=now(),closed_by=$2,counted_cash_bob=NULL
   WHERE id=$1 RETURNING *`,[req.params.id,req.currentUser!.id]);
  await client.query('COMMIT');res.json({...updated.rows[0],expected_cash_bob:expected.toFixed(2),totals_by_method:sums.rows[0],note:'Cierre calculado automáticamente. No se realizó conteo físico.'});
 }catch(e){await client.query('ROLLBACK');jsonError(res,e);}finally{client.release();}
});

salesRouter.get('/',async(req,res)=>{
 const pageRaw=Number(req.query.page??1);
 if(!Number.isSafeInteger(pageRaw)||pageRaw<1||pageRaw>1000000)return res.status(422).json({error:'Página inválida'});
 const page=pageRaw;
 const limit=20;
 try {
  const isAdmin=req.currentUser!.role==='admin';
  const where='WHERE ($1::boolean OR s.seller_id=$2)';
  const count=await pool.query(`SELECT COUNT(*)::int AS total FROM sales s ${where}`,[isAdmin,req.currentUser!.id]);
  const result=await pool.query(`SELECT s.id,s.total_bob,s.status,s.created_at,c.status AS cash_session_status,u.name AS seller_name,r.name AS register_name,
   COALESCE((SELECT json_agg(json_build_object('name',i.product_name,'quantity',i.quantity,'unit_price_bob',i.unit_price_bob)) FROM sale_items i WHERE i.sale_id=s.id),'[]'::json) AS items,
   COALESCE((SELECT json_agg(json_build_object('method',p.method,'amount_bob',p.amount_bob)) FROM sale_payments p WHERE p.sale_id=s.id),'[]'::json) AS payments
   FROM sales s JOIN app_users u ON u.id=s.seller_id JOIN cash_sessions c ON c.id=s.cash_session_id
   JOIN cash_registers r ON r.id=c.cash_register_id ${where}
   ORDER BY s.created_at DESC,s.id DESC LIMIT $3 OFFSET $4`,[isAdmin,req.currentUser!.id,limit,(page-1)*limit]);
  const total=Number(count.rows[0].total);
  res.json({items:result.rows,page,pageSize:limit,total,pages:Math.max(1,Math.ceil(total/limit))});
 }catch(e){jsonError(res,e);}
});

salesRouter.post('/',async(req,res)=>{
 const {request_key,cash_session_id,items,payments}=req.body??{};
 if(typeof request_key!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request_key)||
 !validId(String(cash_session_id))||!Array.isArray(items)||!items.length||items.length>100||!Array.isArray(payments)||!payments.length||payments.length>8)
  return res.status(422).json({error:'Venta inválida'});
 const itemMap=new Map<string,number>();
 for(const i of items){
  if(!validId(String(i?.product_id))||!Number.isSafeInteger(i?.quantity)||i.quantity<=0||i.quantity>100000)
   return res.status(422).json({error:'Cantidades inválidas'});
  const id=String(i.product_id),total=(itemMap.get(id)||0)+i.quantity;
  if(!Number.isSafeInteger(total)||total>100000)return res.status(422).json({error:'Cantidad excedida'});
  itemMap.set(id,total);
 }
 const parsedPayments:{method:string;amountCents:number;reference:string|null}[]=[];
 for(const p of payments){
  const amount=cents(p?.amount_bob);
  if(!['cash','qr','transfer','other'].includes(p?.method)||amount===null||amount<=0|| (p.reference!==undefined&&typeof p.reference!=='string'))
   return res.status(422).json({error:'Pago inválido'});
  parsedPayments.push({method:p.method,amountCents:amount,reference:typeof p.reference==='string'?p.reference.slice(0,120):null});
 }
 const client=await pool.connect();
 try {
  await client.query('BEGIN');
  // Evita repetir ventas si el navegador reintenta la misma solicitud.
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[request_key]);
  const old=await client.query('SELECT id,total_bob FROM sales WHERE request_key=$1',[request_key]);
  if(old.rowCount){await client.query('COMMIT');return res.json({...old.rows[0],already_recorded:true});}
  const session=await client.query(`SELECT id FROM cash_sessions WHERE id=$1 AND status='open' AND closing_limit_at>now() FOR UPDATE`,[cash_session_id]);
  if(!session.rowCount){await client.query('ROLLBACK');return res.status(409).json({error:'La caja está cerrada o venció su horario'});}
  const ordered=[...itemMap.keys()].sort((a,b)=>BigInt(a)<BigInt(b)?-1:1);
  const productRows=[];let totalCents=0;
  for(const id of ordered){
   const product=await client.query(`SELECT id,code,name,price_bob,stock FROM products WHERE id=$1 AND is_active=true FOR UPDATE`,[id]);
   if(!product.rowCount||product.rows[0].stock<itemMap.get(id)!){await client.query('ROLLBACK');return res.status(409).json({error:'Producto sin stock suficiente o desactivado. Actualiza el inventario.'});}
   const p=product.rows[0];const priceCents=Math.round(Number(p.price_bob)*100),quantity=itemMap.get(id)!;
   if(!Number.isSafeInteger(priceCents*quantity)){await client.query('ROLLBACK');return res.status(422).json({error:'Importe demasiado grande'});}
   totalCents+=priceCents*quantity;
   productRows.push({p,priceCents,quantity});
  }
  if(totalCents<=0||!Number.isSafeInteger(totalCents)||totalCents>999999999999){await client.query('ROLLBACK');return res.status(422).json({error:'Total fuera de rango'});}
  if(parsedPayments.reduce((s,p)=>s+p.amountCents,0)!==totalCents){await client.query('ROLLBACK');return res.status(422).json({error:`Los pagos deben sumar Bs ${(totalCents/100).toFixed(2)} (precio actualizado en servidor)`});}
  const created=await client.query(`INSERT INTO sales(request_key,cash_session_id,seller_id,total_bob)
   VALUES($1,$2,$3,$4) RETURNING id,total_bob,created_at`,[request_key,cash_session_id,req.currentUser!.id,totalCents/100]);
  for(const {p,priceCents,quantity} of productRows){
   const line=await client.query(`INSERT INTO sale_items(sale_id,product_id,product_code,product_name,quantity,unit_price_bob,subtotal_bob)
    VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,[created.rows[0].id,p.id,p.code,p.name,quantity,priceCents/100,(priceCents*quantity)/100]);
   await client.query('UPDATE products SET stock=stock-$1,updated_at=now() WHERE id=$2',[quantity,p.id]);
   await client.query(`INSERT INTO inventory_movements(product_id,movement_type,quantity_delta,stock_before,stock_after,reason,performed_by)
    VALUES($1,'sale',$2,$3,$4,$5,$6)`,[p.id,-quantity,p.stock,p.stock-quantity,`Venta #${created.rows[0].id} / detalle #${line.rows[0].id}`,req.currentUser!.id]);
  }
  for(const payment of parsedPayments){await client.query(`INSERT INTO sale_payments(sale_id,method,amount_bob,reference) VALUES($1,$2,$3,$4)`,[created.rows[0].id,payment.method,payment.amountCents/100,payment.reference]);}
  await client.query(`INSERT INTO audit_events(user_id,action,entity_type,entity_id) VALUES($1,'sale.created','sale',$2)`,[req.currentUser!.id,created.rows[0].id]);
  await client.query('COMMIT');res.status(201).json(created.rows[0]);
 }catch(e){await client.query('ROLLBACK');jsonError(res,e);}finally{client.release();}
});

salesRouter.post('/:id/void',requireAdmin,async(req,res)=>{
 const reason=typeof req.body?.reason==='string'?req.body.reason.trim():'';
 if(!validId(req.params.id)||reason.length<5||reason.length>500)return res.status(422).json({error:'Indica un motivo de anulación (5 a 500 caracteres)'});
 const client=await pool.connect();
 try {
  await client.query('BEGIN');
  const reference=await client.query('SELECT cash_session_id FROM sales WHERE id=$1',[req.params.id]);
  if(!reference.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Venta no encontrada'});}
  const cash=await client.query('SELECT status FROM cash_sessions WHERE id=$1 FOR UPDATE',[reference.rows[0].cash_session_id]);
  if(cash.rows[0]?.status!=='open'){await client.query('ROLLBACK');return res.status(409).json({error:'La caja está cerrada. No se permite anular ventas de sesiones cerradas.'});}
  const sale=await client.query(`SELECT * FROM sales WHERE id=$1 FOR UPDATE`,[req.params.id]);
  if(!sale.rowCount||sale.rows[0].status!=='completed'){await client.query('ROLLBACK');return res.status(409).json({error:'La venta no existe o ya está anulada'});}
  const items=await client.query(`SELECT * FROM sale_items WHERE sale_id=$1 ORDER BY product_id`,[req.params.id]);
  for(const item of items.rows){
   const p=await client.query('SELECT stock FROM products WHERE id=$1 FOR UPDATE',[item.product_id]);
   const before=p.rows[0].stock,after=before+item.quantity;
   await client.query('UPDATE products SET stock=$1,updated_at=now() WHERE id=$2',[after,item.product_id]);
   await client.query(`INSERT INTO inventory_movements(product_id,movement_type,quantity_delta,stock_before,stock_after,reason,performed_by)
    VALUES($1,'sale_reversal',$2,$3,$4,$5,$6)`,[item.product_id,item.quantity,before,after,`Anulación venta #${req.params.id}: ${reason}`,req.currentUser!.id]);
  }
  await client.query(`UPDATE sales SET status='voided',voided_at=now(),voided_by=$2,void_reason=$3 WHERE id=$1`,[req.params.id,req.currentUser!.id,reason]);
  await client.query(`INSERT INTO audit_events(user_id,action,entity_type,entity_id,details) VALUES($1,'sale.voided','sale',$2,jsonb_build_object('reason',$3))`,[req.currentUser!.id,req.params.id,reason]);
  await client.query('COMMIT');res.json({success:true,note:'Stock repuesto. Las devoluciones de dinero deben gestionarse y documentarse por separado.'});
 }catch(e){await client.query('ROLLBACK');jsonError(res,e);}finally{client.release();}
});
