import { mkdtempSync, rmSync } from 'node:fs';
import { z } from 'zod';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  closeDatabase,
  getDatabase,
  openDatabase,
  transaction,
} from '../../src/db/database.js';
import { ensureDefaultProject } from '../../src/db/bootstrap.js';

let directory = '';

export function setupTestDatabase() {
  directory = mkdtempSync(join(tmpdir(), 'outreacher-test-'));
  openDatabase(join(directory, 'test.sqlite'));
  return getDatabase();
}

const tables = [
  'recipient_job_attempts',
  'recipient_jobs',
  'messages',
  'campaigns',
  'templates',
  'mail_accounts',
  'custom_fields',
  'contacts',
  'projects',
] as const;

export function resetTestDatabase() {
  const database = getDatabase();
  transaction(() => {
    for (const table of tables) database.prepare(`DELETE FROM ${table}`).run();
    database.prepare('DELETE FROM sqlite_sequence').run();
  });
  return ensureDefaultProject();
}

export function closeTestDatabase() {
  closeDatabase();
}

export function reopenTestDatabase() {
  openDatabase(join(directory, 'test.sqlite'));
  return getDatabase();
}

export function teardownTestDatabase() {
  closeDatabase();
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = '';
}

export function testDatabase() {
  return getDatabase();
}

export function countRows(table: Table) {
  return z
    .object({ total: z.number().int() })
    .parse(getDatabase().prepare(`SELECT COUNT(*) AS total FROM ${table}`).get())
    .total;
}

type Table =
  | 'projects'
  | 'contacts'
  | 'custom_fields'
  | 'mail_accounts'
  | 'templates'
  | 'campaigns'
  | 'messages'
  | 'recipient_jobs'
  | 'recipient_job_attempts';

type RowValue = string | number | null | Date;

function stored(value: RowValue) {
  return value instanceof Date ? value.toISOString() : value;
}

export function setRow(
  table: Table,
  id: string,
  fields: Record<string, RowValue>,
) {
  const columns = Object.keys(fields);
  if (!columns.length) return;
  getDatabase()
    .prepare(
      `UPDATE ${table} SET ${columns.map((column) => `${column} = ?`).join(', ')} WHERE id = ?`,
    )
    .run(...columns.map((column) => stored(fields[column] as RowValue)), id);
}

export function deleteRows(
  table: Table,
  where: Record<string, RowValue>,
) {
  const columns = Object.keys(where);
  getDatabase()
    .prepare(
      `DELETE FROM ${table} WHERE ${columns.map((column) => `${column} = ?`).join(' AND ')}`,
    )
    .run(...columns.map((column) => stored(where[column] as RowValue)));
}

export function updateRows(
  table: Table,
  where: Record<string, RowValue>,
  fields: Record<string, RowValue>,
) {
  const whereColumns = Object.keys(where);
  const columns = Object.keys(fields);
  getDatabase()
    .prepare(
      `UPDATE ${table} SET ${columns.map((column) => `${column} = ?`).join(', ')}
       WHERE ${whereColumns.map((column) => `${column} = ?`).join(' AND ')}`,
    )
    .run(
      ...columns.map((column) => stored(fields[column] as RowValue)),
      ...whereColumns.map((column) => stored(where[column] as RowValue)),
    );
}
