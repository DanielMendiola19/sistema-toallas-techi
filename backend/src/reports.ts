import { Router } from 'express';
import { pool } from './database.js';
import { requireAuth, requireAdmin } from './auth.js';

export const reportsRouter = Router();
reportsRouter.use(requireAuth, requireAdmin);

reportsRouter.get('/overview', async (req, res) => {
  const start = req.query.start, end = req.query.end;
  const timezone = typeof req.query.timezone === 'string' ? req.query.timezone : 'America/La_Paz';
  if (typeof start !== 'string' || typeof end !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T/.test(start) || !/^\d{4}-\d{2}-\d{2}T/.test(end) ||
      !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end))) {
    return res.status(422).json({ error: 'Selecciona fechas válidas' });
  }
  const from = Date.parse(start), to = Date.parse(end);
  if (from >= to || to - from > 367 * 86400000) {
    return res.status(422).json({ error: 'El rango debe ser de máximo 367 días' });
  }
  try { new Intl.DateTimeFormat('es', { timeZone: timezone }); }
  catch { return res.status(422).json({ error: 'Zona horaria inválida' }); }
  try {
    const params = [new Date(from).toISOString(), new Date(to).toISOString()];
    const [sales, payments, daily, products, sellers, stock, cash] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS transactions, COALESCE(SUM(total_bob),0) AS revenue
        FROM sales WHERE status='completed' AND created_at >= $1 AND created_at < $2`,params),
      pool.query(`SELECT p.method, COALESCE(SUM(p.amount_bob),0) AS amount
        FROM sale_payments p JOIN sales s ON s.id=p.sale_id
        WHERE s.status='completed' AND s.created_at >= $1 AND s.created_at < $2
        GROUP BY p.method ORDER BY p.method`,params),
      pool.query(`SELECT TO_CHAR(s.created_at AT TIME ZONE $3, 'YYYY-MM-DD') AS day,
        COUNT(*)::int AS transactions, COALESCE(SUM(s.total_bob),0) AS amount
        FROM sales s WHERE s.status='completed' AND s.created_at >= $1 AND s.created_at < $2
        GROUP BY 1 ORDER BY 1`,[...params,timezone]),
      pool.query(`SELECT i.product_id, i.product_code AS code, i.product_name AS name,
        SUM(i.quantity)::int AS quantity, SUM(i.subtotal_bob) AS amount
        FROM sale_items i JOIN sales s ON s.id=i.sale_id
        WHERE s.status='completed' AND s.created_at >= $1 AND s.created_at < $2
        GROUP BY i.product_id,i.product_code,i.product_name ORDER BY quantity DESC,amount DESC LIMIT 10`,params),
      pool.query(`SELECT u.id,u.name,COUNT(s.id)::int AS transactions,
        COALESCE(SUM(s.total_bob),0) AS amount
        FROM sales s JOIN app_users u ON u.id=s.seller_id
        WHERE s.status='completed' AND s.created_at >= $1 AND s.created_at < $2
        GROUP BY u.id,u.name ORDER BY amount DESC`,params),
      pool.query(`SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER(WHERE stock=0)::int AS out_of_stock,
        COUNT(*) FILTER(WHERE stock>0 AND stock<=min_stock)::int AS low_stock
        FROM products WHERE is_active=true`),
      pool.query(`SELECT COUNT(*)::int AS closed_sessions FROM cash_sessions
        WHERE closed_at >= $1 AND closed_at < $2 AND status='closed'`,params)
    ]);
    const units=products.rows.reduce((sum:number,p:{quantity:number})=>sum+Number(p.quantity),0);
    res.json({period:{start:params[0],end:params[1],timezone},
      summary:{...sales.rows[0],units,closed_sessions:cash.rows[0].closed_sessions},
      payments:payments.rows,daily:daily.rows,top_products:products.rows,sellers:sellers.rows,stock:stock.rows[0]});
  } catch (error) {
    console.error('Error generando reportes', error);
    res.status(500).json({error:'No se pudo generar el reporte'});
  }
});
