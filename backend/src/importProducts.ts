import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import { pool } from './database.js';
import { requireAuth, requireAdmin } from './auth.js';

export const importProductsRouter = Router();
importProductsRouter.use(requireAuth, requireAdmin);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } }).single('file');
type Row = { row: number; code: string; name: string; price_bob: number; stock: number | null; min_stock: number };
type Column = 'code' | 'name' | 'price_bob' | 'stock' | 'min_stock';
type Template = { sheet: ExcelJS.Worksheet; header: number; columns: Record<Column, number> };
const clean = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim();
const normalized = (v: unknown) => clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const synonyms: Record<Column, string[]> = {
  code: ['cod', 'codigo', 'codigo producto', 'codigo de producto', 'sku', 'referencia', 'ref', 'id producto'],
  name: ['articulo', 'articulos', 'producto', 'productos', 'nombre', 'nombre producto', 'nombre del producto', 'descripcion', 'detalle'],
  price_bob: ['precio', 'precio bs', 'precio bob', 'precio venta', 'precio de venta', 'precio unitario', 'p venta', 'valor unitario'],
  stock: ['stock', 'existencia', 'existencias', 'cantidad', 'cantidad disponible', 'stock actual', 'stock inicial', 'saldo', 'saldo actual', 'unidades'],
  min_stock: ['min stock', 'minimo', 'stock minimo', 'alerta desde', 'stock de alerta', 'cantidad minima'],
};
function value(cell: ExcelJS.Cell): unknown {
  const x = cell.value;
  if (x && typeof x === 'object') {
    if ('result' in x) return (x as ExcelJS.CellFormulaValue).result;
    if ('text' in x) return (x as { text: string }).text;
    if ('richText' in x) return (x as { richText: { text: string }[] }).richText.map(p => p.text).join('');
  }
  return x;
}
function columnsFor(sheet: ExcelJS.Worksheet): Template | null {
  let best: Template | null = null;
  let bestScore = -1;
  for (let r = 1; r <= Math.min(sheet.rowCount, 35); r++) {
    const matches = {} as Record<Column, number>;
    for (let c = 1; c <= Math.min(sheet.columnCount, 40); c++) {
      const label = normalized(value(sheet.getCell(r, c)));
      if (!label) continue;
      for (const key of Object.keys(synonyms) as Column[]) {
        if (!matches[key] && synonyms[key].includes(label)) matches[key] = c;
      }
    }
    if (matches.code && matches.name && matches.price_bob && matches.stock) {
      const positions = [matches.code, matches.name, matches.price_bob, matches.stock];
      if (new Set(positions).size !== 4) continue;
      const score = Object.keys(matches).length;
      if (score > bestScore) {
        bestScore = score;
        best = { sheet, header: r, columns: { ...matches, min_stock: matches.min_stock || 0 } };
      }
    }
  }
  return best;
}
function parseNumber(x: unknown): number {
  if (typeof x === 'number') return x;
  if (typeof x !== 'string' || !x.trim()) return NaN;
  let s = x.trim().replace(/\s/g, '').replace(/^(?:Bs\.?|BOB)/i, '').trim();
  // Accept 12,50 / 1.200,50 / 1,200.50, never interpret ambiguous formats silently.
  if (/^-?\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(?:,\d{3})+\.\d{1,2}$/.test(s)) s = s.replace(/,/g, '');
  else if (/^-?\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');
  if (!/^-?\d+(?:\.\d+)?$/.test(s)) return NaN;
  return Number(s);
}
function extractRows(template: Template): Row[] {
  const { sheet, header, columns: c } = template;
  const rows: Row[] = [];
  const codes = new Set<string>();
  for (let i = header + 1; i <= sheet.rowCount; i++) {
    const code = clean(value(sheet.getCell(i, c.code)));
    const name = clean(value(sheet.getCell(i, c.name)));
    const priceRaw = value(sheet.getCell(i, c.price_bob));
    const stockRaw = value(sheet.getCell(i, c.stock));
    if (!code && !name && clean(priceRaw) === '' && clean(stockRaw) === '') continue;
    if (/^(total|totales|subtotal|resumen|observaciones)$/i.test(normalized(code)) && !name) continue;
    if (!code || !name) throw Error(`Hoja «${sheet.name}», fila ${i}: falta código o nombre del producto.`);
    const p = parseNumber(priceRaw);
    const s = parseNumber(stockRaw);
    if (!Number.isFinite(p) || p < 0 || p > 9999999999.99 || Math.abs(p * 100 - Math.round(p * 100)) > 0.00001)
      throw Error(`Hoja «${sheet.name}», fila ${i} (${code}): precio no válido. Si es una fórmula, abre y guarda el Excel para actualizar su resultado.`);
    const validStock = Number.isSafeInteger(s) && s >= 0 && s <= 2147483647;
    const min = c.min_stock ? parseNumber(value(sheet.getCell(i, c.min_stock))) : 2;
    if (!Number.isSafeInteger(min) || min < 0 || min > 2147483647) throw Error(`Hoja «${sheet.name}», fila ${i}: alerta mínima inválida.`);
    if (code.length > 50 || name.length > 200) throw Error(`Hoja «${sheet.name}», fila ${i}: código o nombre demasiado largo.`);
    const key = code.toLocaleLowerCase('es');
    if (codes.has(key)) throw Error(`Hoja «${sheet.name}»: código duplicado en el Excel: ${code}.`);
    codes.add(key);
    rows.push({ row: i, code, name, price_bob: Math.round(p * 100) / 100, stock: validStock ? s : null, min_stock: min });
  }
  if (!rows.length) throw Error(`La hoja «${sheet.name}» no contiene productos válidos debajo de sus encabezados.`);
  if (rows.length > 10000) throw Error('Máximo 10.000 productos por importación.');
  return rows;
}
async function inspect(buffer: Buffer) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer as any);
  const templates: Template[] = [];
  book.eachSheet(sheet => { const t = columnsFor(sheet); if (t) templates.push(t); });
  if (!templates.length) throw Error('No se encontró una hoja con columnas identificables de Código, Producto/Artículo, Precio y Stock. Revisa los encabezados del Excel.');
  return templates;
}
function sheetChoice(templates: Template[], requested: unknown) {
  if (typeof requested === 'string' && requested.trim()) {
    const match = templates.find(t => t.sheet.name === requested);
    if (!match) throw Error(`La hoja «${requested}» no tiene encabezados compatibles. Selecciona una hoja válida.`);
    return match;
  }
  // Prefer an explicit selection if several sheets contain inventory, avoid mixing worksheets.
  if (templates.length > 1) return templates[0];
  return templates[0];
}
function multipart(req: any, res: any, next: any) {
  upload(req, res, (err: any) => { if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'El Excel supera los 8 MB.' : err.message }); next(); });
}
function uploaded(req: any) {
  if (!req.file || !/\.xlsx$/i.test(req.file.originalname)) throw Error('Selecciona un archivo Excel .xlsx válido.');
  return req.file.buffer as Buffer;
}
async function existingCodes(rows: Row[]) {
  const q = await pool.query('SELECT code FROM products WHERE lower(code)=ANY($1::text[])', [rows.map(r => r.code.toLowerCase())]);
  return new Set<string>(q.rows.map(r => String(r.code).toLowerCase()));
}
importProductsRouter.post('/preview', multipart, async (req, res) => {
  try {
    const buffer = uploaded(req);
    const templates = await inspect(buffer);
    const choice = sheetChoice(templates, req.body.sheet);
    const rows = extractRows(choice);
    const existing = await existingCodes(rows);
    res.json({ sheet: choice.sheet.name, sheets: templates.map(t => t.sheet.name), sha256: createHash('sha256').update(buffer).digest('hex'), total: rows.length,
      rows: rows.map(r => ({ ...r, exists: existing.has(r.code.toLowerCase()) })) });
  } catch (e) { res.status(422).json({ error: e instanceof Error ? e.message : 'Excel inválido' }); }
});
importProductsRouter.post('/commit', multipart, async (req, res) => {
  let client;
  try {
    const buffer = uploaded(req);
    const digest = createHash('sha256').update(buffer).digest('hex');
    if (req.body.sha256 !== digest) return res.status(409).json({ error: 'El archivo cambió desde la vista previa. Vuelve a revisarlo.' });
    if (typeof req.body.sheet !== 'string' || !req.body.sheet) return res.status(422).json({ error: 'Revisa primero la hoja que deseas importar.' });
    const templates = await inspect(buffer);
    const choice = sheetChoice(templates, req.body.sheet);
    const rows = extractRows(choice);
    const decisions = JSON.parse(String(req.body.decisions ?? 'null')) as unknown;
    if (!Array.isArray(decisions)) return res.status(422).json({ error: 'Selección de productos inválida.' });
    const selected = new Map<number, number>();
    for (const d of decisions) {
      if (!d || typeof d !== 'object') return res.status(422).json({ error: 'Selección inválida.' });
      const x = d as Record<string, unknown>;
      if (!Number.isInteger(x.row) || !Number.isSafeInteger(x.stock) || Number(x.stock) < 0 || Number(x.stock) > 2147483647 || selected.has(Number(x.row)))
        return res.status(422).json({ error: 'Hay filas o cantidades inválidas o duplicadas.' });
      selected.set(Number(x.row), Number(x.stock));
    }
    if (!selected.size) return res.status(422).json({ error: 'Selecciona al menos un producto nuevo.' });
    const toCreate = rows.filter(r => selected.has(r.row));
    if (toCreate.length !== selected.size) return res.status(422).json({ error: 'Hay filas que no pertenecen a la hoja validada.' });
    client = await pool.connect(); await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(783421059)');
    const existing = await client.query('SELECT code FROM products WHERE lower(code)=ANY($1::text[])', [toCreate.map(r => r.code.toLowerCase())]);
    if (existing.rowCount) { await client.query('ROLLBACK'); client.release(); client = undefined; return res.status(409).json({ error: `Hay ${existing.rowCount} códigos que ya existen. Actualiza la vista previa; no se importó nada.` }); }
    const created = [];
    for (const row of toCreate) {
      const count = selected.get(row.row)!;
      const result = await client.query('INSERT INTO products(code,name,price_bob,stock,min_stock) VALUES($1,$2,$3,$4,$5) RETURNING id,code,name,stock', [row.code, row.name, row.price_bob, count, row.min_stock]);
      const product = result.rows[0]; created.push(product);
      if (count > 0) await client.query(`INSERT INTO inventory_movements(product_id,movement_type,quantity_delta,stock_before,stock_after,reason,performed_by) VALUES($1,'initial',$2,0,$2,$3,$4)`, [product.id, count, `Importación de Excel: hoja «${choice.sheet.name}», fila ${row.row}`, req.currentUser!.id]);
    }
    await client.query('COMMIT'); client.release(); client = undefined;
    res.status(201).json({ created: created.length, products: created });
  } catch (e) { if (client) { await client.query('ROLLBACK').catch(() => {}); client.release(); } console.error('Error de importación:', e); res.status(422).json({ error: e instanceof Error ? e.message : 'No se pudo importar' }); }
});
