import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { PRODUCT_IMAGES_DIR, uploadExistingProductImage } from '../src/productImages.js';

const dir = path.resolve(process.env.PRODUCT_IMAGES_DIR || PRODUCT_IMAGES_DIR);
async function main() {
  const entries = await readdir(dir);
  const files = entries.filter(name => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.webp$/i.test(name));
  console.log(`Fotografías locales detectadas: ${files.length}`);
  let uploaded = 0, existing = 0, failed = 0;
  for (const filename of files) {
    try {
      const status = await uploadExistingProductImage(filename, await readFile(path.join(dir, filename)));
      if (status === 'uploaded') uploaded++; else existing++;
      console.log(`${filename}: ${status === 'uploaded' ? 'subida' : 'ya existente'}`);
    } catch (error) {
      failed++;
      console.error(`${filename}: ERROR`, error instanceof Error ? error.message : error);
    }
  }
  console.log(`Resultado: ${uploaded} subidas, ${existing} existentes, ${failed} errores`);
  if (failed) process.exitCode = 1;
}
main().catch(e => { console.error(e); process.exitCode = 1; });
