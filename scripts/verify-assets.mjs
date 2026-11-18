import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(root, 'docs/migration/preserved-assets.json'), 'utf8'));
const hashes = new Map();
for (const { source, target, sha256 } of manifest.files) {
  const actual = createHash('sha256').update(readFileSync(resolve(root, target))).digest('hex');
  if (actual !== sha256) throw new Error('SHA-256 distinto para ' + target + ' (' + source + ')');
  hashes.set(target, actual);
}
const models = readdirSync(resolve(root, 'assets/3d'), { recursive: true })
  .filter(name => /\.(stl|obj)$/i.test(name)).map(name => 'assets/3d/' + name.replaceAll('\\', '/'));
if (models.length !== manifest.stl + manifest.obj || !models.every(name => hashes.has(name))) {
  throw new Error('Inventario de modelos distinto al del commit auditado');
}
console.log(`${hashes.size} archivos idénticos al origen, incluidos ${manifest.stl} STL y ${manifest.obj} OBJ.`);
