import { Router } from 'express';
import { pool } from './database.js';
import { requireAuth, requireAdmin } from './auth.js';

export const managementRouter = Router();
managementRouter.use(requireAuth, requireAdmin);
const validDate = (s:unknown) => typeof s==='string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s+'T00:00:00Z'));
const pageFrom=(v:unknown)=> {const n=Number(v??1);return Number.isSafeInteger(n)&&n>=1&&n<=100000?n:null;};
const sendError=(res:any,error:unknown)=>{console.error('Error administración:',error);res.status(500).json({error:'No se pudo consultar la información'});};

// Auditoría paginada. Filtro por fecha UTC de calendario; la interfaz muestra hora local.
managementRouter.get('/audit',async(req,res)=>{
 const page=pageFrom(req.query.page);
 const {action,user_id,start,end}=req.query;
 if(!page || (action!==undefined && (typeof action!=='string'||action.length>80)) ||
    (user_id!==undefined && (typeof user_id!=='string'||!/^\d+$/.test(user_id))) ||
    (start!==undefined&&!validDate(start)) || (end!==undefined&&!validDate(end)) ||
    (start && end && String(start)>String(end)))
  return res.status(422).json({error:'Filtros inválidos'});
 const terms:string[]=[];const args:unknown[]=[];
 const add=(sql:string,val:unknown)=>{args.push(val);terms.push(sql.replace('?',`$${args.length}`));};
 if(action)add('a.action = ?',action);
 if(user_id)add('a.user_id = ?',user_id);
 if(start)add('a.created_at >= ?::date',start);
 if(end)add('a.created_at < (?::date + interval \'1 day\')',end);
 const where=terms.length?'WHERE '+terms.join(' AND '):'';
 try{
  const total=Number((await pool.query(`SELECT count(*)::int AS n FROM audit_events a ${where}`,args)).rows[0].n);
  const rows=await pool.query(`SELECT a.id,a.created_at,a.action,a.entity_type,a.entity_id,a.details,
    COALESCE(u.name,'Sistema / no identificado') AS actor_name
    FROM audit_events a LEFT JOIN app_users u ON u.id=a.user_id ${where}
    ORDER BY a.created_at DESC,a.id DESC LIMIT 20 OFFSET $${args.length+1}`,
    [...args,(page-1)*20]);
  return res.json({items:rows.rows,total,page,pages:Math.max(1,Math.ceil(total/20)),pageSize:20});
 }catch(e){return sendError(res,e);}
});

// Caja histórica: únicamente lectura; no requiere introducir dinero contado.
managementRouter.get('/cash-sessions',async(req,res)=>{
 const page=pageFrom(req.query.page);
 if(!page)return res.status(422).json({error:'Página inválida'});
 try{
  const total=Number((await pool.query('SELECT count(*)::int AS n FROM cash_sessions')).rows[0].n);
  const result=await pool.query(`SELECT c.id,c.opened_at,c.closed_at,c.closing_limit_at,c.status,
   r.name AS register_name,op.name AS opened_by_name,cl.name AS closed_by_name,
   c.opening_cash_bob,
   COALESCE(SUM(p.amount_bob) FILTER(WHERE s.status='completed' AND p.method='cash'),0) AS cash_sales,
   COALESCE(SUM(p.amount_bob) FILTER(WHERE s.status='completed' AND p.method='qr'),0) AS qr_sales,
   COALESCE(SUM(p.amount_bob) FILTER(WHERE s.status='completed' AND p.method='transfer'),0) AS transfer_sales,
   COALESCE(SUM(p.amount_bob) FILTER(WHERE s.status='completed' AND p.method='other'),0) AS other_sales,
   COUNT(DISTINCT s.id) FILTER(WHERE s.status='completed')::int AS sales_count
   FROM cash_sessions c JOIN cash_registers r ON r.id=c.cash_register_id
   JOIN app_users op ON op.id=c.opened_by LEFT JOIN app_users cl ON cl.id=c.closed_by
   LEFT JOIN sales s ON s.cash_session_id=c.id LEFT JOIN sale_payments p ON p.sale_id=s.id
   GROUP BY c.id,r.name,op.name,cl.name ORDER BY c.opened_at DESC,c.id DESC LIMIT 20 OFFSET $1`,[(page-1)*20]);
  res.json({items:result.rows,total,page,pages:Math.max(1,Math.ceil(total/20)),pageSize:20});
 }catch(e){sendError(res,e);}
});
managementRouter.get('/cash-sessions/:id/sellers',async(req,res)=>{
 if(!/^\d+$/.test(req.params.id))return res.status(422).json({error:'Caja inválida'});
 try{
  const found=await pool.query('SELECT id FROM cash_sessions WHERE id=$1',[req.params.id]);
  if(!found.rowCount)return res.status(404).json({error:'Sesión no encontrada'});
  const rows=await pool.query(`SELECT u.name AS seller_name,COUNT(*)::int AS sales_count,
   COALESCE(SUM(s.total_bob),0) AS total_bob
   FROM sales s JOIN app_users u ON u.id=s.seller_id
   WHERE s.cash_session_id=$1 AND s.status='completed'
   GROUP BY u.id,u.name ORDER BY total_bob DESC,u.name`,[req.params.id]);
  res.json(rows.rows);
 }catch(e){sendError(res,e);}
});
