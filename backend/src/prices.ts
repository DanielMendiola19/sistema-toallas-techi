import { Router } from 'express';
import { pool } from './database.js';
import { requireAuth, requireAdmin } from './auth.js';
export const pricesRouter=Router();
pricesRouter.use(requireAuth);
function validPrice(raw:unknown):raw is number {return typeof raw==='number'&&Number.isFinite(raw)&&raw>=0&&raw<=9999999999.99&&/^\d+(\.\d{1,2})?$/.test(String(raw));}
pricesRouter.get('/requests',async(req,res,next)=>{
 try {
  const all=req.currentUser!.role==='admin';
  const result=await pool.query(`SELECT r.*,p.name AS product_name,p.code AS product_code,
   u.name AS requested_by_name FROM price_requests r
   JOIN products p ON p.id=r.product_id JOIN app_users u ON u.id=r.requested_by
   WHERE ($1::boolean OR r.requested_by=$2) ORDER BY r.created_at DESC LIMIT 200`,[all,req.currentUser!.id]);
  res.json(result.rows);
 }catch(error){next(error);}
});
pricesRouter.post('/requests',async(req,res,next)=>{
 const {product_id,new_price_bob}=req.body||{};
 if(!/^\d+$/.test(String(product_id))||!validPrice(new_price_bob)){res.status(422).json({error:'Indica producto y nuevo precio válido (máximo dos decimales)'});return;}
 const client=await pool.connect();
 try {
  await client.query('BEGIN');
  const product=await client.query('SELECT id,price_bob FROM products WHERE id=$1 AND is_active=true FOR UPDATE',[product_id]);
  if(!product.rowCount){await client.query('ROLLBACK');res.status(404).json({error:'Producto no encontrado'});return;}
  if(Number(product.rows[0].price_bob)===new_price_bob){await client.query('ROLLBACK');res.status(422).json({error:'El nuevo precio debe ser diferente'});return;}
  const created=await client.query(`INSERT INTO price_requests(product_id,requested_by,old_price_bob,new_price_bob)
    VALUES($1,$2,$3,$4) RETURNING *`,[product_id,req.currentUser!.id,product.rows[0].price_bob,new_price_bob]);
  await client.query('COMMIT');res.status(201).json(created.rows[0]);
 }catch(error){await client.query('ROLLBACK');next(error);}finally{client.release();}
});
pricesRouter.patch('/requests/:id/review',requireAdmin,async(req,res,next)=>{
 const {decision}=req.body||{};
 if(!/^\d+$/.test(String(req.params.id))||!['approved','rejected'].includes(decision)){res.status(422).json({error:'Revisión inválida'});return;}
 const client=await pool.connect();
 try {
  await client.query('BEGIN');
  const r=await client.query('SELECT * FROM price_requests WHERE id=$1 FOR UPDATE',[req.params.id]);
  if(!r.rowCount){await client.query('ROLLBACK');res.status(404).json({error:'Solicitud no encontrada'});return;}
  const request=r.rows[0];
  if(request.status!=='pending'){await client.query('ROLLBACK');res.status(409).json({error:'La solicitud ya fue revisada'});return;}
  if(decision==='approved'){
   const prod=await client.query('SELECT price_bob FROM products WHERE id=$1 AND is_active=true FOR UPDATE',[request.product_id]);
   if(!prod.rowCount||Number(prod.rows[0].price_bob)!==Number(request.old_price_bob)){
    await client.query('ROLLBACK');res.status(409).json({error:'El precio del producto cambió. Rechaza esta solicitud y crea otra.'});return;
   }
   await client.query('UPDATE products SET price_bob=$1,updated_at=now() WHERE id=$2',[request.new_price_bob,request.product_id]);
   await client.query(`INSERT INTO price_history(product_id,old_price_bob,new_price_bob,changed_by,request_id)
    VALUES($1,$2,$3,$4,$5)`,[request.product_id,request.old_price_bob,request.new_price_bob,req.currentUser!.id,request.id]);
  }
  const updated=await client.query(`UPDATE price_requests SET status=$1,reviewed_by=$2,reviewed_at=now() WHERE id=$3 RETURNING *`,[decision,req.currentUser!.id,request.id]);
  await client.query(`INSERT INTO audit_events(user_id,action,entity_type,entity_id,details)
    VALUES($1,$2,'price_request',$3,$4::jsonb)`,[req.currentUser!.id,decision,request.id,JSON.stringify({product_id:request.product_id})]);
  await client.query('COMMIT');res.json(updated.rows[0]);
 }catch(error){await client.query('ROLLBACK');next(error);}finally{client.release();}
});

// El administrador modifica el precio directamente tras confirmar en React.
pricesRouter.patch('/products/:id',requireAdmin,async(req,res,next)=>{
 const id=String(req.params.id);
 const newPrice=req.body?.new_price_bob;
 if(!/^\d+$/.test(id)||!validPrice(newPrice))return res.status(422).json({error:'Precio o producto inválido'});
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const old=await client.query('SELECT id,price_bob FROM products WHERE id=$1 AND is_active=true FOR UPDATE',[id]);
  if(!old.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Producto no encontrado'});}
  if(Number(old.rows[0].price_bob)===newPrice){await client.query('ROLLBACK');return res.status(422).json({error:'El nuevo precio debe ser diferente del actual'});}
  await client.query('UPDATE products SET price_bob=$1,updated_at=now() WHERE id=$2',[newPrice,id]);
  await client.query(`INSERT INTO price_history(product_id,old_price_bob,new_price_bob,changed_by,request_id)
    VALUES($1,$2,$3,$4,NULL)`,[id,old.rows[0].price_bob,newPrice,req.currentUser!.id]);
  await client.query(`INSERT INTO audit_events(user_id,action,entity_type,entity_id,details)
    VALUES($1,'price.direct_change','product',$2,$3::jsonb)`,[req.currentUser!.id,id,JSON.stringify({old_price_bob:old.rows[0].price_bob,new_price_bob:newPrice})]);
  await client.query('COMMIT');res.json({id,price_bob:newPrice});
 }catch(e){await client.query('ROLLBACK');next(e);}finally{client.release();}
});
