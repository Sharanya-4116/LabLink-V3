import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut, type Auth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
};

let app: FirebaseApp | null = null;
let auth: Auth | null = null;

export function isFirebaseClientConfigured(): boolean {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
}

export function getFirebaseClientAuth(): Auth | null {
  if (!isFirebaseClientConfigured()) return null;
  if (!app) {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
  }
  return auth;
}

export async function signInWithCampusEmail(email: string, password: string): Promise<string> {
  const clientAuth = getFirebaseClientAuth();
  if (!clientAuth) {
    throw new Error('Firebase Authentication is not configured in this environment.');
  }
  const cred = await signInWithEmailAndPassword(clientAuth, email, password);
  return cred.user.getIdToken();
}

export async function signOutCampusAuth(): Promise<void> {
  const clientAuth = getFirebaseClientAuth();
  if (clientAuth) {
    await signOut(clientAuth);
  }
}
