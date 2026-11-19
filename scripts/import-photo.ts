import { readFile } from 'node:fs/promises';
import { getFirestore } from 'firebase-admin/firestore';
import { isJpeg, photoName } from '../src/lib/contracts.ts';
import { firebaseAdmin } from '../src/lib/server/firebase-admin.ts';

const [name, path] = process.argv.slice(2);
if (!name || !path || !photoName.test(name)) {
  console.error('Uso: pnpm firebase:import-photo NOMBRE_EN_FIRESTORE RUTA_DEL_JPEG');
  process.exit(1);
}

try {
  const bytes = await readFile(path);
  if (!isJpeg(bytes)) throw new Error('El archivo debe ser un JPEG de hasta 400 000 bytes.');
  const database = getFirestore(firebaseAdmin());
  const metadata = database.collection('photos').doc(name);
  const image = database.collection('photo_images').doc(name);
  const imported = await database.runTransaction(async (tx) => {
    const [photo, existing] = await tx.getAll(metadata, image);
    if (!photo.exists) throw new Error('El documento original photos/' + name + ' debe existir.');
    if (existing.exists) {
      const previous: unknown = existing.get('bytes');
      if (previous instanceof Uint8Array && bytes.equals(previous)) return false;
      throw new Error('La galería ya contiene otro JPEG para ese registro.');
    }
    tx.create(image, { bytes });
    tx.update(metadata, { size: bytes.length });
    return true;
  });
  console.log(imported ? 'Foto importada en Firestore.' : 'Ese JPEG ya está en la galería.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'No se pudo importar la foto.');
  process.exitCode = 1;
}
