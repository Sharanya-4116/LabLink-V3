import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import type { ServerConfig } from './config.ts';

let initializedApp: App | null = null;

export function getFirebaseAdminApp(config: ServerConfig): App {
  if (initializedApp) return initializedApp;
  const existing = getApps();
  if (existing.length > 0 && existing[0]) {
    initializedApp = existing[0];
    return initializedApp;
  }

  if (config.firebaseClientEmail && config.firebasePrivateKey && config.firebaseProjectId) {
    initializedApp = initializeApp({
      credential: cert({
        projectId: config.firebaseProjectId,
        clientEmail: config.firebaseClientEmail,
        privateKey: config.firebasePrivateKey,
      }),
      projectId: config.firebaseProjectId,
    });
    return initializedApp;
  }

  // Uses Google Cloud Run Application Default Credentials (ADC) when deployed on Cloud Run
  initializedApp = initializeApp(
    config.firebaseProjectId ? { projectId: config.firebaseProjectId } : undefined
  );
  return initializedApp;
}

export function getFirebaseAdminAuth(config: ServerConfig): Auth {
  return getAuth(getFirebaseAdminApp(config));
}

export function getFirebaseAdminFirestore(config: ServerConfig): Firestore {
  return getFirestore(getFirebaseAdminApp(config));
}
