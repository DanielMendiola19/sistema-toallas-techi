import { Router } from 'express';
import { pool } from './database.js';
import { requireAuth, requireAdmin } from './auth.js';

export const productsRouter = Router();
productsRouter.use(requireAuth);
const FIELDS = 'id, code, name, price_bob, stock, min_stock, is_active, created_at, updated_at';

function parseProduct(body: unknown) {
  if (!body || typeof body !== 'object') return { error: 'Datos inválidos' } as const;
  const input = body as Record<string, unknown>;
  const code = typeof input.code === 'string' ? input.code.trim() : '';
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const price = input.price_bob;
  const stock = input.stock;
  const min = input.min_stock ?? 2;
  if (!code || code.length > 50 || !name || name.length > 200) return { error: 'Código y nombre son obligatorios (máximo 50 y 200 caracteres)' } as const;
  // Exigimos números JSON, no cadenas, para evitar conversiones silenciosas.
  if (typeof price !== 'number' || !Number.isFinite(price) || price < 0 || !Number.isInteger(price * 100) || price > 9999999999.99) return { error: 'Precio inválido (máximo dos decimales)' } as const;
  if (typeof stock !== 'number' || !Number.isSafeInteger(stock) || stock < 0 || stock > 2147483647) return { error: 'Stock inválido' } as const;
  if (typeof min !== 'number' || !Number.isSafeInteger(min) || min < 0 || min > 2147483647) return { error: 'Stock mínimo inválido' } as const;
  return { value: { code, name, price, stock, min } } as const;
}

function fail(res: any, error: unknown) {
  const e = error as { code?: string };
  if (e.code === '23505') return res.status(409).json({ error: 'Ya existe un producto con ese código' });
  console.error('Error de productos:', error);
  return res.status(500).json({ error: 'Error interno del servidor' });
}

productsRouter.get('/', async (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const low = req.query.low === 'true';
    const result = await pool.query(
      `SELECT ${FIELDS} FROM products WHERE is_active = TRUE
       AND ($1::text = '' OR code ILIKE '%' || $1 || '%' OR name ILIKE '%' || $1 || '%')
       AND ($2::boolean = FALSE OR stock <= min_stock)
       ORDER BY name ASC, id ASC LIMIT 500`, [q, low]);
    res.json(result.rows);
  } catch (error) { fail(res, error); }
});

productsRouter.post('/', requireAdmin, async (req, res) => {
  const parsed = parseProduct(req.body);
  if ('error' in parsed) return res.status(422).json({ error: parsed.error });
  const { code, name, price, stock, min } = parsed.value;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const created = await client.query(`INSERT INTO products (code,name,price_bob,stock,min_stock)
      VALUES ($1,$2,$3,$4,$5) RETURNING ${FIELDS}`, [code, name, price, stock, min]);
    if (stock > 0) await client.query(`INSERT INTO inventory_movements
      (product_id,movement_type,quantity_delta,stock_before,stock_after,reason,performed_by)
      VALUES ($1,'initial',$2,0,$2,'Inventario inicial',$3)`, [created.rows[0].id, stock, req.currentUser!.id]);
    await client.query('COMMIT');
    res.status(201).json(created.rows[0]);
  } catch (error) { await client.query('ROLLBACK'); fail(res, error); }
  finally { client.release(); }
});

productsRouter.put('/:id', requireAdmin, async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'ID inválido' });
  const parsed = parseProduct(req.body);
  if ('error' in parsed) return res.status(422).json({ error: parsed.error });
  const { code, name, price, min } = parsed.value;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const previous = await client.query('SELECT stock,price_bob FROM products WHERE id=$1 AND is_active=TRUE FOR UPDATE', [req.params.id]);
    if (!previous.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Producto no encontrado' }); }
    const updated = await client.query(`UPDATE products SET code=$1,name=$2,price_bob=$3,min_stock=$4,
       updated_at=NOW() WHERE id=$5 RETURNING ${FIELDS}`,
       [code, name, price, min, req.params.id]);
    if (Number(previous.rows[0].price_bob) !== price) await client.query(`INSERT INTO price_history (product_id,old_price_bob,new_price_bob,changed_by) VALUES ($1,$2,$3,$4)`,[req.params.id,previous.rows[0].price_bob,price,req.currentUser!.id]);
    await client.query('COMMIT');
    res.json(updated.rows[0]);
  } catch (error) { await client.query('ROLLBACK'); fail(res, error); }
  finally { client.release(); }
});

productsRouter.delete('/:id', requireAdmin, async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'ID inválido' });
  try {
    const result = await pool.query(`UPDATE products SET is_active=FALSE,updated_at=NOW()
      WHERE id=$1 AND is_active=TRUE RETURNING id`, [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Producto no encontrado' });
    res.status(204).send();
  } catch (error) { fail(res, error); }
});

productsRouter.get('/:id/movements', async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'ID inválido' });
  try {
    const result = await pool.query(`SELECT * FROM inventory_movements
      WHERE product_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100`, [req.params.id]);
    res.json(result.rows);
  } catch (error) { fail(res, error); }
});
