import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const [action, uid] = process.argv.slice(2);
const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId || (action !== 'grant' && action !== 'revoke') || !uid || uid.length > 128 || uid.includes('/')) {
  console.error('Uso: pnpm firebase:operator grant|revoke UID (requiere FIREBASE_PROJECT_ID).');
  process.exit(1);
}
const app = initializeApp({ projectId, credential: applicationDefault() });
try {
  if (action === 'grant') await getAuth(app).getUser(uid);
  await getFirestore(app).collection('operators').doc(uid).set({
    active: action === 'grant', updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  console.log('Operador ' + (action === 'grant' ? 'habilitado' : 'revocado') + '.');
} catch (error) {
  console.error('No se pudo actualizar el operador.', (error as { code?: unknown }).code ?? (error as Error).name);
  process.exitCode = 1;
}
