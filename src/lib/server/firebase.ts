import 'server-only';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { firebaseAdmin } from './firebase-admin';

export const auth = () => getAuth(firebaseAdmin());
export const db = () => getFirestore(firebaseAdmin());
