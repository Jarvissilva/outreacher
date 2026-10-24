import { homedir } from 'node:os';
import { resolve } from 'node:path';
import {
  closeDatabase,
  isDatabaseReady,
  openDatabase,
} from '../db/database.js';

export function databasePath() {
  if (process.env.DATABASE_PATH) return resolve(process.env.DATABASE_PATH);
  const dataDir = resolve(
    process.env.DATA_DIR ?? resolve(homedir(), '.local', 'share', 'outreacher'),
  );
  return resolve(dataDir, 'outreacher.sqlite');
}

export function connectDatabase() {
  return openDatabase(databasePath());
}

export { closeDatabase, isDatabaseReady };
