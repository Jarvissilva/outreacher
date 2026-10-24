import { z } from 'zod';
import type { FieldInput } from '@outreacher/shared';
import { getDatabase, transaction } from '../database.js';
import { newId, nowIso, toDate } from '../values.js';

const fieldRowSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  key: z.string(),
  label: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
type FieldRow = z.infer<typeof fieldRowSchema>;

export interface CustomField {
  id: string;
  projectId: string;
  key: string;
  label: string;
  createdAt: Date;
  updatedAt: Date;
}

function fromRow(row: FieldRow): CustomField {
  return {
    id: row.id,
    projectId: row.projectId,
    key: row.key,
    label: row.label,
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
  };
}

export function serializeField(field: CustomField) {
  return {
    id: field.id,
    projectId: field.projectId,
    key: field.key,
    label: field.label,
  };
}

export function listFields(projectId: string): CustomField[] {
  return getDatabase()
    .prepare(
      'SELECT * FROM custom_fields WHERE projectId = ? ORDER BY createdAt ASC, id ASC',
    )
    .all(projectId)
    .map((row) => fromRow(fieldRowSchema.parse(row)));
}

export function findField(projectId: string, id: string): CustomField | undefined {
  const row = getDatabase()
    .prepare('SELECT * FROM custom_fields WHERE projectId = ? AND id = ?')
    .get(projectId, id);
  return row === undefined ? undefined : fromRow(fieldRowSchema.parse(row));
}

export function findFieldByKey(
  projectId: string,
  key: string,
): CustomField | undefined {
  const row = getDatabase()
    .prepare('SELECT * FROM custom_fields WHERE projectId = ? AND "key" = ?')
    .get(projectId, key);
  return row === undefined ? undefined : fromRow(fieldRowSchema.parse(row));
}

export function countFieldsByKeys(projectId: string, keys: string[]): number {
  if (!keys.length) return 0;
  const row = getDatabase()
    .prepare(
      'SELECT COUNT(*) AS total FROM custom_fields WHERE projectId = ? AND "key" IN (SELECT value FROM json_each(?))',
    )
    .get(projectId, JSON.stringify(keys));
  return z.object({ total: z.number().int() }).parse(row).total;
}

export function createField(projectId: string, input: FieldInput): CustomField {
  const id = newId();
  const now = nowIso();
  getDatabase()
    .prepare(
      'INSERT INTO custom_fields (id, projectId, "key", label, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(id, projectId, input.key, input.label, now, now);
  const field = findField(projectId, id);
  if (!field) throw new Error('Custom field creation failed.');
  return field;
}

export function updateFieldLabel(
  projectId: string,
  id: string,
  label: string,
): CustomField | undefined {
  const result = getDatabase()
    .prepare(
      'UPDATE custom_fields SET label = ?, updatedAt = ? WHERE projectId = ? AND id = ?',
    )
    .run(label, nowIso(), projectId, id);
  return result.changes === 0 ? undefined : findField(projectId, id);
}

export type DeleteFieldResult = 'deleted' | 'missing' | 'referenced';

export function deleteField(projectId: string, id: string): DeleteFieldResult {
  const db = getDatabase();
  const field = findField(projectId, id);
  if (!field) return 'missing';
  const path = `$."${field.key}"`;
  const used = db
    .prepare(
      `SELECT 1 FROM contacts
       WHERE projectId = ? AND deletedAt IS NULL
         AND json_extract(customFields, ?) IS NOT NULL
         AND json_extract(customFields, ?) <> ''
       LIMIT 1`,
    )
    .get(projectId, path, path);
  if (used) return 'referenced';
  transaction(() => {
    db.prepare(
      'UPDATE contacts SET customFields = json_remove(customFields, ?), updatedAt = ? WHERE projectId = ?',
    ).run(path, nowIso(), projectId);
    db.prepare('DELETE FROM custom_fields WHERE projectId = ? AND id = ?').run(
      projectId,
      id,
    );
  });
  return 'deleted';
}
