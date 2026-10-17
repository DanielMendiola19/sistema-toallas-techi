
import express from 'express';
import cors from 'cors';
import 'dotenv/config';

import { testConnection } from './database.js';

import { productsRouter } from './products.js';
import { authRouter, usersRouter } from './auth.js';
import { pricesRouter } from './prices.js';
import { salesRouter } from './sales.js';
import { reportsRouter } from './reports.js';
import { inventoryRouter } from './inventory.js';
import { managementRouter } from './management.js';
import { importProductsRouter } from './importProducts.js';

// NUEVO: ubicación de las fotografías optimizadas.
import { PRODUCT_IMAGES_DIR, storagePublicImageUrl } from './productImages.js';

const app = express();

const PORT = Number(process.env.PORT || 3000);

// =============================================
// CONFIGURACIÓN ORIGINAL
// =============================================

app.disable('x-powered-by');

// El frontend local y el dominio público publicado en Render.
// FRONTEND_URL debe contener la URL completa, sin barra final.
const allowedOrigins = new Set([
  'http://localhost:5173',
  ...(process.env.FRONTEND_URL || '').split(',').map(s => s.trim()).filter(Boolean)
]);
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error('Origen no permitido por CORS'));
  }
}));

// Conservamos el límite de JSON original.
// Las fotografías usan multipart/form-data.
app.use(
  express.json({
    limit: '100kb'
  })
);

// =============================================
// NUEVO: MOSTRAR FOTOGRAFÍAS DE PRODUCTOS
// =============================================

// Las fotografías del catálogo serán públicas
// para que puedan verse en Inventario.
//
// Solo los administradores pueden subirlas,
// reemplazarlas o quitarlas, mediante productsRouter.
// Las rutas de fotos antiguas siguen funcionando sin modificar React.
// En producción redirigimos hacia las imágenes públicas de Supabase Storage.
// En desarrollo local, sin configurar Storage, conservamos los archivos locales.
app.get('/product-images/:key', (req, res, next) => {
  const key = req.params.key as string;
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.webp$/i.test(key)) {
    res.status(404).send('Fotografía no encontrada');
    return;
  }
  const url = storagePublicImageUrl(key);
  if (url) {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.redirect(302, url);
    return;
  }
  next();
});
app.use('/product-images', express.static(PRODUCT_IMAGES_DIR, {
  index: false, dotfiles: 'deny', maxAge: '1h',
  setHeaders(res) { res.setHeader('X-Content-Type-Options', 'nosniff'); }
}));

// =============================================
// ESTADO DEL SERVIDOR - ORIGINAL
// =============================================

app.get('/api/health', (_req, res) =>
  res.json({
    success: true,
    message: 'API de Sistema Toallas funcionando',
    timestamp: new Date().toISOString()
  })
);

// =============================================
// TODAS LAS RUTAS ORIGINALES
// =============================================

app.use('/api/auth', authRouter);

app.use('/api/users', usersRouter);

app.use('/api/products', productsRouter);

app.use('/api/prices', pricesRouter);

app.use('/api/sales', salesRouter);

app.use('/api/reports', reportsRouter);

app.use('/api/inventory', inventoryRouter);

app.use('/api/management', managementRouter);

app.use(
  '/api/imports/products',
  importProductsRouter
);

// =============================================
// MANEJO DE ERRORES - ORIGINAL
// =============================================

app.use((
  error: unknown,
  _req: express.Request,
  res: express.Response,
  _next: express.NextFunction
) => {
  console.error('Error de API:', error);

  res.status(500).json({
    error: 'Error interno del servidor'
  });
});

// =============================================
// INICIAR SERVIDOR - ORIGINAL
// =============================================

async function start() {
  try {
    await testConnection();

    app.listen(PORT, () => {
      console.log(
        `🚀 Servidor: http://localhost:${PORT}`
      );
    });
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

void start();
