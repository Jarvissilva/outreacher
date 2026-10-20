import { migrateMessageJobs } from './migrations/messageJobs.js';
import { migrateEmailAccounts } from './migrations/emailAccounts.js';
import { createEmailIndexes } from './models/EmailModels.js';
import { startSendingWorker } from './services/sendingWorker.js';
import { app } from './app.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { migrateProjects } from './migrations/projects.js';

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 3001);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}

try {
  await connectDatabase();
  await migrateProjects();
  await migrateEmailAccounts();
  await migrateMessageJobs();
  await createEmailIndexes();
} catch {
  console.error(
    'Could not initialize MongoDB. Check MONGODB_URI and database migration/index permissions.',
  );
  await disconnectDatabase();
  process.exit(1);
}

const stopWorker = startSendingWorker();
const server = app.listen(port, host, () => {
  console.log(`OutreachIt API listening on http://${host}:${port}`);
});

server.on('error', (error) => {
  console.error(error);
  void disconnectDatabase().finally(() => {
    process.exitCode = 1;
  });
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    stopWorker();
    server.close(() => {
      void disconnectDatabase().then(
        () => process.exit(0),
        () => process.exit(1),
      );
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
