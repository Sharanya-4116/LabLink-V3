export type AppMode = 'demo' | 'production';
export type PersistenceDriver = 'sqlite' | 'firestore';

export interface ServerConfig {
  port: number;
  nodeEnv: string;
  appMode: AppMode;
  allowDemoRoleSwitch: boolean;
  persistenceDriver: PersistenceDriver;
  sqliteDbPath: string;
  campusTimezone: string;
  noShowGraceMinutes: number;
  internalSweepSecret: string;
  firebaseProjectId: string;
  firebaseClientEmail: string;
  firebasePrivateKey: string;
}

export function loadServerConfig(overrides?: Partial<ServerConfig>): ServerConfig {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const rawMode = (process.env.APP_MODE || 'demo').toLowerCase();
  const appMode: AppMode = rawMode === 'production' ? 'production' : 'demo';

  // CRITICAL SECURITY GUARD: Production mode unconditionally disables demo role switching
  const allowDemoRoleSwitch =
    appMode === 'production'
      ? false
      : (process.env.ALLOW_DEMO_ROLE_SWITCH ?? 'true').toLowerCase() === 'true';

  const rawDriver = (process.env.PERSISTENCE_DRIVER || 'sqlite').toLowerCase();
  const persistenceDriver: PersistenceDriver =
    rawDriver === 'firestore' ? 'firestore' : 'sqlite';

  // AI Studio dev server runs on port 3000; Cloud Run production defaults to 8080
  const defaultPort = nodeEnv === 'production' ? 8080 : 3000;
  const port = Number(process.env.PORT) || defaultPort;

  const parsedGrace = Number(process.env.NO_SHOW_GRACE_MINUTES);
  const noShowGraceMinutes =
    Number.isFinite(parsedGrace) && parsedGrace >= 1 ? Math.floor(parsedGrace) : 20;

  const config: ServerConfig = {
    port,
    nodeEnv,
    appMode,
    allowDemoRoleSwitch,
    persistenceDriver,
    sqliteDbPath: process.env.SQLITE_DB_PATH || './data/lablink.db',
    campusTimezone: process.env.CAMPUS_TIMEZONE || 'Asia/Kolkata',
    noShowGraceMinutes,
    internalSweepSecret: process.env.INTERNAL_SWEEP_SECRET || '',
    firebaseProjectId: process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || '',
    firebaseClientEmail: process.env.FIREBASE_CLIENT_EMAIL || '',
    firebasePrivateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    ...overrides,
  };

  if (config.appMode === 'production') {
    config.allowDemoRoleSwitch = false;
  }

  return config;
}
