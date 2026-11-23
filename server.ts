import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createApiApp } from './server/app.ts';
import { loadServerConfig } from './server/config.ts';
import { getFirebaseAdminFirestore } from './server/firebaseAdmin.ts';
import { FirestoreRepository } from './server/repositories/FirestoreRepository.ts';
import type { IDataRepository } from './server/repositories/IDataRepository.ts';
import { SqliteRepository } from './server/repositories/SqliteRepository.ts';

async function bootstrap() {
  const config = loadServerConfig();

  let repo: IDataRepository;
  if (config.persistenceDriver === 'firestore') {
    const firestore = getFirebaseAdminFirestore(config);
    repo = new FirestoreRepository(firestore, config.campusTimezone);
  } else {
    repo = new SqliteRepository(config.sqliteDbPath, config.campusTimezone);
  }

  await repo.init();

  const app = createApiApp(repo, config);

  if (config.nodeEnv !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) {
        res.status(404).json({ error: 'NOT_FOUND', message: 'API route not found' });
        return;
      }
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        next();
      }
    });
  }

  app.listen(config.port, '0.0.0.0', () => {
    console.log(
      `LabLink V3 listening on http://0.0.0.0:${config.port} [mode=${config.appMode}, driver=${config.persistenceDriver}, tz=${config.campusTimezone}]`
    );
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start LabLink V3 server:', err);
  process.exit(1);
});
