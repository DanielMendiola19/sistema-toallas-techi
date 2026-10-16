
import sharp from 'sharp';
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

  let metadata: sharp.Metadata;

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

export async function saveProductImage(
  data: Buffer
): Promise<string> {
  if (
    data.length === 0 ||
    data.length > MAX_STORED_IMAGE_BYTES
  ) {
    throw new Error(
      'El archivo optimizado supera el límite permitido'
    );
  }

  await mkdir(PRODUCT_IMAGES_DIR, {
    recursive: true
  });

  const imageKey = `${randomUUID()}.webp`;

  await writeFile(
    path.join(PRODUCT_IMAGES_DIR, imageKey),
    data,
    {
      flag: 'wx'
    }
  );

  // PostgreSQL guardará únicamente este nombre.
  return imageKey;
}

// =============================================
// ELIMINAR FOTOGRAFÍA ANTERIOR
// =============================================

export async function removeProductImage(
  imageKey: string | null | undefined
): Promise<void> {
  if (
    !imageKey ||
    !IMAGE_KEY_PATTERN.test(imageKey)
  ) {
    return;
  }

  try {
    await unlink(
      path.join(PRODUCT_IMAGES_DIR, imageKey)
    );
  } catch (error) {
    const code = (
      error as NodeJS.ErrnoException
    ).code;

    // Si el archivo ya no existe, no es necesario
    // interrumpir la operación.
    if (code !== 'ENOENT') {
      console.error(
        'No se pudo eliminar la fotografía anterior:',
        error
      );
    }
  }
}
