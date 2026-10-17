
import sharp from 'sharp';
import type { Metadata } from 'sharp';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import * as path from 'node:path';

// Máximo original: 2 MB.
export const MAX_ORIGINAL_IMAGE_BYTES = 2 * 1024 * 1024;

// Máximo almacenado: 150 KB.
export const MAX_STORED_IMAGE_BYTES = 150 * 1024;

// En desarrollo guarda fotografías en:
// backend/uploads/product-images
//
// PRODUCT_IMAGES_DIR permite configurar otra carpeta
// sin modificar este archivo.
export const PRODUCT_IMAGES_DIR = path.resolve(
  process.env.PRODUCT_IMAGES_DIR ||
    path.join(process.cwd(), 'uploads', 'product-images')
);

const VALID_FORMATS = new Set([
  'jpeg',
  'png',
  'webp'
]);

// Solo permitimos eliminar archivos con nombres
// generados por nuestro propio sistema.
const IMAGE_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/i;

// Supabase Storage se activa solo con estas dos variables en backend.
// La clave service_role es privada y NUNCA debe exponerse en Vite/React.
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const STORAGE_BUCKET = 'product-images';
const useStorage = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

function storageObjectEndpoint(imageKey: string): string {
  return `${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${encodeURIComponent(imageKey)}`;
}

export function storagePublicImageUrl(imageKey: string): string | null {
  if (!useStorage || !IMAGE_KEY_PATTERN.test(imageKey)) return null;
  return `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${encodeURIComponent(imageKey)}`;
}

async function storageRequest(method: 'POST' | 'DELETE', imageKey: string, data?: Buffer): Promise<Response> {
  const response = await fetch(storageObjectEndpoint(imageKey), {
    method,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      ...(data ? { 'Content-Type': 'image/webp', 'cache-control': '3600', 'x-upsert': 'false' } : {})
    },
    ...(data ? { body: new Uint8Array(data) } : {})
  });
  return response;
}

// Reutilizado por la migración de imágenes antiguas, sin cambiar image_key.
export async function uploadExistingProductImage(imageKey: string, data: Buffer): Promise<'uploaded' | 'exists'> {
  if (!useStorage) throw new Error('Configura SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY');
  if (!IMAGE_KEY_PATTERN.test(imageKey)) throw new Error('Nombre de fotografía inválido');
  if (data.length === 0 || data.length > MAX_STORED_IMAGE_BYTES) throw new Error('La imagen supera 150 KB');
  const res = await storageRequest('POST', imageKey, data);
  if (res.ok) return 'uploaded';
  const message = await res.text();
  if (res.status === 409 || (res.status === 400 && /already exists|duplicate/i.test(message))) return 'exists';
  throw new Error(`Supabase Storage rechazó la fotografía (${res.status}): ${message.slice(0, 250)}`);
}

// Intentos de compresión progresiva.
const COMPRESSION_ATTEMPTS = [
  { dimension: 800, quality: 80 },
  { dimension: 800, quality: 70 },
  { dimension: 700, quality: 65 },
  { dimension: 600, quality: 60 },
  { dimension: 500, quality: 55 },
  { dimension: 400, quality: 50 },
  { dimension: 320, quality: 45 }
];

// =============================================
// COMPRIMIR FOTOGRAFÍA
// =============================================

export async function optimizeProductImage(
  input: Buffer
): Promise<Buffer> {
  if (
    input.length === 0 ||
    input.length > MAX_ORIGINAL_IMAGE_BYTES
  ) {
    throw new Error(
      'La fotografía debe pesar como máximo 2 MB'
    );
  }

  let metadata: Metadata;

  try {
    metadata = await sharp(input, {
      limitInputPixels: 16_000_000
    }).metadata();
  } catch {
    throw new Error(
      'La fotografía está dañada o no es una imagen válida'
    );
  }

  if (
    !metadata.format ||
    !VALID_FORMATS.has(metadata.format)
  ) {
    throw new Error(
      'Solo se permiten imágenes JPG, PNG o WebP'
    );
  }

  for (const attempt of COMPRESSION_ATTEMPTS) {
    const result = await sharp(input, {
      limitInputPixels: 16_000_000
    })
      .rotate()
      .resize({
        width: attempt.dimension,
        height: attempt.dimension,
        fit: 'inside',
        withoutEnlargement: true
      })
      .webp({
        quality: attempt.quality,
        effort: 4
      })
      .toBuffer();

    if (result.length <= MAX_STORED_IMAGE_BYTES) {
      return result;
    }
  }

  throw new Error(
    'No se pudo reducir la fotografía a 150 KB. Prueba con otra imagen.'
  );
}

// =============================================
// GUARDAR FOTOGRAFÍA LOCALMENTE
// =============================================

export async function saveProductImage(data: Buffer): Promise<string> {
  if (data.length === 0 || data.length > MAX_STORED_IMAGE_BYTES) {
    throw new Error('El archivo optimizado supera el límite permitido');
  }

  const imageKey = `${randomUUID()}.webp`;
  if (useStorage) {
    await uploadExistingProductImage(imageKey, data);
    return imageKey;
  }

  // Compatible con desarrollo local si Storage no está configurado.
  // En Render DEBEN configurarse las variables de Supabase Storage.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Supabase Storage no está configurado en el servidor');
  }
  await mkdir(PRODUCT_IMAGES_DIR, { recursive: true });
  await writeFile(path.join(PRODUCT_IMAGES_DIR, imageKey), data, { flag: 'wx' });
  return imageKey;
}

// =============================================
// ELIMINAR FOTOGRAFÍA ANTERIOR
// =============================================

export async function removeProductImage(imageKey: string | null | undefined): Promise<void> {
  if (!imageKey || !IMAGE_KEY_PATTERN.test(imageKey)) return;
  try {
    if (useStorage) {
      const res = await storageRequest('DELETE', imageKey);
      // Una foto antigua sin migrar puede no existir aún en Storage.
      if (!res.ok && res.status !== 404) {
        console.error('No se pudo eliminar la fotografía anterior de Storage:', res.status, (await res.text()).slice(0, 250));
      }
      return;
    }
    await unlink(path.join(PRODUCT_IMAGES_DIR, imageKey));
  } catch (error) {
    if (!useStorage && (error as NodeJS.ErrnoException).code === 'ENOENT') return;
    console.error('No se pudo eliminar la fotografía anterior:', error);
  }
}
