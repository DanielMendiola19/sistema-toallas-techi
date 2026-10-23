
import { Router, type RequestHandler } from 'express';
import multer from 'multer';

import { pool } from './database.js';
import { requireAuth, requireAdmin } from './auth.js';

import {
  MAX_ORIGINAL_IMAGE_BYTES,
  optimizeProductImage,
  saveProductImage,
  removeProductImage
} from './productImages.js';

export const productsRouter = Router();

productsRouter.use(requireAuth);

// Express 5 permite que los parámetros sean string o string[]; validamos su tipo.
const isProductId = (id: unknown): id is string =>
  typeof id === 'string' && /^\d+$/.test(id);

// Se agrega image_key al listado original.
const FIELDS =
  'id, code, name, price_bob, stock, min_stock, is_active, image_key, created_at, updated_at';

// =============================================
// VALIDACIÓN ORIGINAL DE PRODUCTOS
// =============================================

function parseProduct(body: unknown) {
  if (!body || typeof body !== 'object') {
    return {
      error: 'Datos inválidos'
    } as const;
  }

  const input = body as Record<string, unknown>;

  const code =
    typeof input.code === 'string'
      ? input.code.trim()
      : '';

  const name =
    typeof input.name === 'string'
      ? input.name.trim()
      : '';

  const price = input.price_bob;
  const stock = input.stock;
  const min = input.min_stock ?? 2;

  if (
    !code ||
    code.length > 50 ||
    !name ||
    name.length > 200
  ) {
    return {
      error:
        'Código y nombre son obligatorios (máximo 50 y 200 caracteres)'
    } as const;
  }

  // Exigimos números JSON, no cadenas,
  // para evitar conversiones silenciosas.
  if (
    typeof price !== 'number' ||
    !Number.isFinite(price) ||
    price < 0 ||
    !Number.isInteger(price * 100) ||
    price > 9999999999.99
  ) {
    return {
      error: 'Precio inválido (máximo dos decimales)'
    } as const;
  }

  if (
    typeof stock !== 'number' ||
    !Number.isSafeInteger(stock) ||
    stock < 0 ||
    stock > 2147483647
  ) {
    return {
      error: 'Stock inválido'
    } as const;
  }

  if (
    typeof min !== 'number' ||
    !Number.isSafeInteger(min) ||
    min < 0 ||
    min > 2147483647
  ) {
    return {
      error: 'Stock mínimo inválido'
    } as const;
  }

  return {
    value: {
      code,
      name,
      price,
      stock,
      min
    }
  } as const;
}

// =============================================
// MANEJO ORIGINAL DE ERRORES
// =============================================

function fail(res: any, error: unknown) {
  const e = error as {
    code?: string;
  };

  if (e.code === '23505') {
    return res.status(409).json({
      error: 'Ya existe un producto con ese código'
    });
  }

  console.error('Error de productos:', error);

  return res.status(500).json({
    error: 'Error interno del servidor'
  });
}

// =============================================
// LISTAR PRODUCTOS - ORIGINAL
// =============================================

productsRouter.get('/', async (req, res) => {
  try {
    const q =
      typeof req.query.q === 'string'
        ? req.query.q.trim().slice(0, 100)
        : '';

    const low = req.query.low === 'true';

    const result = await pool.query(
      `SELECT ${FIELDS}
       FROM products
       WHERE is_active = TRUE
         AND (
           $1::text = ''
           OR code ILIKE '%' || $1 || '%'
           OR name ILIKE '%' || $1 || '%'
         )
         AND (
           $2::boolean = FALSE
           OR stock <= min_stock
         )
       ORDER BY lower(regexp_replace(code, '[0-9]+$', '')) ASC,
                CASE WHEN code ~ '[0-9]+$' THEN (substring(code FROM '([0-9]+)$'))::numeric ELSE NULL END ASC NULLS LAST,
                upper(code) ASC, id ASC
       LIMIT 500`,
      [q, low]
    );

    res.json(result.rows);
  } catch (error) {
    fail(res, error);
  }
});

// Administradores pueden consultar productos archivados para restaurarlos.
productsRouter.get('/inactive', requireAdmin, async (_req, res) => {
  try {
    const data = await pool.query(`SELECT ${FIELDS} FROM products
      WHERE is_active=FALSE
      ORDER BY lower(regexp_replace(code, '[0-9]+$', '')) ASC,
        CASE WHEN code ~ '[0-9]+$' THEN (substring(code FROM '([0-9]+)$'))::numeric ELSE NULL END ASC NULLS LAST,
        upper(code) ASC, id ASC`);
    res.json(data.rows);
  } catch (error) { fail(res, error); }
});

// Restaurar sin borrar historial, ventas ni fotografías.
productsRouter.patch('/:id/status', requireAdmin, async (req, res) => {
  if (!isProductId(req.params.id)) return res.status(400).json({error:'ID inválido'});
  if (typeof req.body?.is_active !== 'boolean') return res.status(422).json({error:'Estado inválido'});
  try {
    const result = await pool.query(`UPDATE products SET is_active=$1,updated_at=NOW()
      WHERE id=$2 AND is_active IS DISTINCT FROM $1 RETURNING ${FIELDS}`,
      [req.body.is_active,req.params.id]);
    if (!result.rowCount) return res.status(404).json({error:'Producto no encontrado o ya tiene ese estado'});
    res.json(result.rows[0]);
  } catch(error) { fail(res,error); }
});

// =============================================
// CREAR PRODUCTO - ORIGINAL
// =============================================

productsRouter.post(
  '/',
  requireAdmin,
  async (req, res) => {
    const parsed = parseProduct(req.body);

    if ('error' in parsed) {
      return res.status(422).json({
        error: parsed.error
      });
    }

    const {
      code,
      name,
      price,
      stock,
      min
    } = parsed.value;

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const created = await client.query(
        `INSERT INTO products (
          code,
          name,
          price_bob,
          stock,
          min_stock
        )
        VALUES ($1,$2,$3,$4,$5)
        RETURNING ${FIELDS}`,
        [code, name, price, stock, min]
      );

      if (stock > 0) {
        await client.query(
          `INSERT INTO inventory_movements (
            product_id,
            movement_type,
            quantity_delta,
            stock_before,
            stock_after,
            reason,
            performed_by
          )
          VALUES (
            $1,
            'initial',
            $2,
            0,
            $2,
            'Inventario inicial',
            $3
          )`,
          [
            created.rows[0].id,
            stock,
            req.currentUser!.id
          ]
        );
      }

      await client.query('COMMIT');

      res.status(201).json(
        created.rows[0]
      );
    } catch (error) {
      await client.query('ROLLBACK');
      fail(res, error);
    } finally {
      client.release();
    }
  }
);

// =============================================
// EDITAR PRODUCTO - ORIGINAL
// =============================================

productsRouter.put(
  '/:id',
  requireAdmin,
  async (req, res) => {
    if (!isProductId(req.params.id)) {
      return res.status(400).json({
        error: 'ID inválido'
      });
    }

    const parsed = parseProduct(req.body);

    if ('error' in parsed) {
      return res.status(422).json({
        error: parsed.error
      });
    }

    const {
      code,
      name,
      price,
      min
    } = parsed.value;

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const previous = await client.query(
        `SELECT stock, price_bob
         FROM products
         WHERE id=$1 AND is_active=TRUE
         FOR UPDATE`,
        [req.params.id]
      );

      if (!previous.rowCount) {
        await client.query('ROLLBACK');

        return res.status(404).json({
          error: 'Producto no encontrado'
        });
      }

      // Se mantiene la edición original:
      // no modifica el stock directamente.
      const updated = await client.query(
        `UPDATE products
         SET
           code=$1,
           name=$2,
           price_bob=$3,
           min_stock=$4,
           updated_at=NOW()
         WHERE id=$5
         RETURNING ${FIELDS}`,
        [
          code,
          name,
          price,
          min,
          req.params.id
        ]
      );

      // Se conserva el historial de precios.
      if (
        Number(previous.rows[0].price_bob) !== price
      ) {
        await client.query(
          `INSERT INTO price_history (
            product_id,
            old_price_bob,
            new_price_bob,
            changed_by
          )
          VALUES ($1,$2,$3,$4)`,
          [
            req.params.id,
            previous.rows[0].price_bob,
            price,
            req.currentUser!.id
          ]
        );
      }

      await client.query('COMMIT');

      res.json(updated.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      fail(res, error);
    } finally {
      client.release();
    }
  }
);

// =============================================
// DESACTIVAR PRODUCTO - ORIGINAL
// =============================================

productsRouter.delete(
  '/:id',
  requireAdmin,
  async (req, res) => {
    if (!isProductId(req.params.id)) {
      return res.status(400).json({
        error: 'ID inválido'
      });
    }

    try {
      const result = await pool.query(
        `UPDATE products
         SET
           is_active=FALSE,
           updated_at=NOW()
         WHERE id=$1
           AND is_active=TRUE
         RETURNING id`,
        [req.params.id]
      );

      if (!result.rowCount) {
        return res.status(404).json({
          error: 'Producto no encontrado'
        });
      }

      res.status(204).send();
    } catch (error) {
      fail(res, error);
    }
  }
);

// =============================================
// NUEVO: CONFIGURACIÓN PARA FOTOGRAFÍAS
// =============================================

const imageUpload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: MAX_ORIGINAL_IMAGE_BYTES,
    files: 1,
    fields: 0
  },

  fileFilter: (_req, file, callback) => {
    const accepted = [
      'image/jpeg',
      'image/png',
      'image/webp'
    ];

    if (!accepted.includes(file.mimetype)) {
      callback(
        new Error(
          'Solo se permiten imágenes JPG, PNG o WebP'
        )
      );
      return;
    }

    callback(null, true);
  }
});

// Manejamos los errores de Multer para que
// aparezcan mensajes claros en el frontend.
const receiveImage: RequestHandler = (
  req,
  res,
  next
) => {
  imageUpload.single('image')(
    req,
    res,
    (error: unknown) => {
      if (!error) {
        next();
        return;
      }

      if (
        error instanceof multer.MulterError &&
        error.code === 'LIMIT_FILE_SIZE'
      ) {
        res.status(413).json({
          error: 'La fotografía no puede superar 2 MB'
        });
        return;
      }

      res.status(422).json({
        error:
          error instanceof Error
            ? error.message
            : 'No se pudo recibir la fotografía'
      });
    }
  );
};

// =============================================
// NUEVO: SUBIR O REEMPLAZAR FOTOGRAFÍA
// POST /api/products/:id/image
// =============================================

productsRouter.post(
  '/:id/image',
  requireAdmin,
  receiveImage,
  async (req, res) => {
    if (!isProductId(req.params.id)) {
      return res.status(400).json({
        error: 'ID inválido'
      });
    }

    if (!req.file) {
      return res.status(422).json({
        error: 'Selecciona una fotografía'
      });
    }

    let converted: Buffer;

    try {
      converted = await optimizeProductImage(
        req.file.buffer
      );
    } catch (error) {
      return res.status(422).json({
        error:
          error instanceof Error
            ? error.message
            : 'Fotografía inválida'
      });
    }

    const client = await pool.connect();

    let newImageKey: string | null = null;
    let committed = false;

    try {
      await client.query('BEGIN');

      // Bloqueamos el producto para evitar
      // modificaciones simultáneas de su foto.
      const previous = await client.query(
        `SELECT image_key
         FROM products
         WHERE id=$1 AND is_active=TRUE
         FOR UPDATE`,
        [req.params.id]
      );

      if (!previous.rowCount) {
        await client.query('ROLLBACK');

        return res.status(404).json({
          error: 'Producto no encontrado'
        });
      }

      // Guardar archivo optimizado.
      newImageKey = await saveProductImage(converted);

      // Asociar archivo al producto en PostgreSQL.
      const updated = await client.query(
        `UPDATE products
         SET
           image_key=$1,
           updated_at=NOW()
         WHERE id=$2
           AND is_active=TRUE
         RETURNING ${FIELDS}`,
        [newImageKey, req.params.id]
      );

      await client.query('COMMIT');
      committed = true;

      // La imagen anterior se elimina solamente
      // después de confirmar la transacción.
      await removeProductImage(
        previous.rows[0].image_key
      );

      res.json(updated.rows[0]);
    } catch (error) {
      if (!committed) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          console.error(
            'Error al revertir foto:',
            rollbackError
          );
        }

        // Limpiar archivo nuevo si falló PostgreSQL.
        if (newImageKey) {
          await removeProductImage(newImageKey);
        }
      }

      fail(res, error);
    } finally {
      client.release();
    }
  }
);

// =============================================
// NUEVO: QUITAR FOTOGRAFÍA
// DELETE /api/products/:id/image
// =============================================

productsRouter.delete(
  '/:id/image',
  requireAdmin,
  async (req, res) => {
    if (!isProductId(req.params.id)) {
      return res.status(400).json({
        error: 'ID inválido'
      });
    }

    const client = await pool.connect();

    let committed = false;

    try {
      await client.query('BEGIN');

      const previous = await client.query(
        `SELECT image_key
         FROM products
         WHERE id=$1 AND is_active=TRUE
         FOR UPDATE`,
        [req.params.id]
      );

      if (!previous.rowCount) {
        await client.query('ROLLBACK');

        return res.status(404).json({
          error: 'Producto no encontrado'
        });
      }

      const updated = await client.query(
        `UPDATE products
         SET
           image_key=NULL,
           updated_at=NOW()
         WHERE id=$1
           AND is_active=TRUE
         RETURNING ${FIELDS}`,
        [req.params.id]
      );

      await client.query('COMMIT');
      committed = true;

      await removeProductImage(
        previous.rows[0].image_key
      );

      res.json(updated.rows[0]);
    } catch (error) {
      if (!committed) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          console.error(
            'Error al revertir eliminación:',
            rollbackError
          );
        }
      }

      fail(res, error);
    } finally {
      client.release();
    }
  }
);

// =============================================
// CONSULTAR MOVIMIENTOS - ORIGINAL
// =============================================

productsRouter.get(
  '/:id/movements',
  async (req, res) => {
    if (!isProductId(req.params.id)) {
      return res.status(400).json({
        error: 'ID inválido'
      });
    }

    try {
      const result = await pool.query(
        `SELECT *
         FROM inventory_movements
         WHERE product_id=$1
         ORDER BY created_at DESC, id DESC
         LIMIT 100`,
        [req.params.id]
      );

      res.json(result.rows);
    } catch (error) {
      fail(res, error);
    }
  }
);
