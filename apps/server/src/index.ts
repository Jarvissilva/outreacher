import { bootstrapDatabase } from './db/bootstrap.js';
import { startSendingWorker } from './services/sendingWorker.js';
import { app } from './app.js';
import { closeDatabase, connectDatabase } from './config/database.js';
import { host, port } from './config/server.js';

try {
  connectDatabase();
  bootstrapDatabase();
} catch (error) {
  console.error(
    'Could not initialize SQLite. Check DATA_DIR or DATABASE_PATH and directory permissions.',
    error,
  );
  closeDatabase();
  process.exit(1);
}

const stopWorker = startSendingWorker();
const server = app.listen(port, host, () => {
  console.log(`Outreacher API listening on http://${host}:${port}`);
});

server.on('error', (error) => {
  console.error(error);
  stopWorker();
  closeDatabase();
  process.exitCode = 1;
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    stopWorker();
    server.close(() => {
      closeDatabase();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
