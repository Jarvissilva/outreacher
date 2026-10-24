import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { migrate } from './schema.js';

export type DB = Database.Database;

let database: DB | undefined;

export function openDatabase(path: string): DB {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  migrate(db);
  database = db;
  return db;
}

export function getDatabase(): DB {
  if (!database?.open) throw new Error('Database is not open.');
  return database;
}

export function closeDatabase() {
  if (database?.open) database.close();
  database = undefined;
}

export function isDatabaseReady() {
  try {
    getDatabase().prepare('SELECT 1').get();
    return true;
  } catch {
    return false;
  }
}

export function transaction<T>(work: () => T): T {
  return getDatabase().transaction(work).immediate();
}

export function one<T>(schema: { parse(value: unknown): T }, row: unknown): T | undefined {
  return row === undefined ? undefined : schema.parse(row);
}

export function many<T>(schema: { parse(value: unknown): T }, rows: unknown[]): T[] {
  return rows.map((row) => schema.parse(row));
}
