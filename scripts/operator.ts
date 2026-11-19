import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { firebaseAdmin } from '../src/lib/server/firebase-admin.ts';

const [action, uid] = process.argv.slice(2);
if ((action !== 'grant' && action !== 'revoke') || !uid || uid.length > 128 || uid.includes('/')) {
  console.error('Uso: pnpm firebase:operator grant|revoke UID (requiere FIREBASE_PROJECT_ID).');
  process.exit(1);
}
try {
  const app = firebaseAdmin();
  if (action === 'grant') await getAuth(app).getUser(uid);
  await getFirestore(app).collection('operators').doc(uid).set({
    active: action === 'grant', updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  console.log('Operador ' + (action === 'grant' ? 'habilitado' : 'revocado') + '.');
} catch (error) {
  console.error('No se pudo actualizar el operador.', (error as { code?: unknown }).code ?? (error as Error).message);
  process.exitCode = 1;
}
