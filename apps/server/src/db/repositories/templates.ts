import { z } from 'zod';
import { getDatabase } from '../database.js';
import { newId, nowIso, toDate } from '../values.js';

const templateRowSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  subject: z.string(),
  html: z.string(),
  text: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
type TemplateRow = z.infer<typeof templateRowSchema>;

export interface Template {
  id: string;
  projectId: string;
  name: string;
  subject: string;
  html: string;
  text: string;
  createdAt: Date;
  updatedAt: Date;
}

function fromRow(row: TemplateRow): Template {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    subject: row.subject,
    html: row.html,
    text: row.text,
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
  };
}

export function serializeTemplate(template: Template) {
  return {
    id: template.id,
    projectId: template.projectId,
    name: template.name,
    subject: template.subject,
    html: template.html,
    text: template.text,
  };
}

export function listTemplates(projectId: string): Template[] {
  return getDatabase()
    .prepare(
      'SELECT * FROM templates WHERE projectId = ? ORDER BY createdAt DESC, id DESC',
    )
    .all(projectId)
    .map((row) => fromRow(templateRowSchema.parse(row)));
}

export function findTemplate(
  projectId: string,
  id: string,
): Template | undefined {
  const row = getDatabase()
    .prepare('SELECT * FROM templates WHERE projectId = ? AND id = ?')
    .get(projectId, id);
  return row === undefined ? undefined : fromRow(templateRowSchema.parse(row));
}

export function createTemplate(
  projectId: string,
  input: { name: string; subject: string; html: string; text: string },
): Template {
  const id = newId();
  const now = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO templates (id, projectId, name, subject, html, text, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      projectId,
      input.name,
      input.subject,
      input.html,
      input.text,
      now,
      now,
    );
  const template = findTemplate(projectId, id);
  if (!template) throw new Error('Template creation failed.');
  return template;
}

export function updateTemplate(
  projectId: string,
  id: string,
  input: { name: string; subject: string; html: string; text: string },
): Template | undefined {
  const result = getDatabase()
    .prepare(
      `UPDATE templates SET name = ?, subject = ?, html = ?, text = ?, updatedAt = ?
       WHERE projectId = ? AND id = ?`,
    )
    .run(input.name, input.subject, input.html, input.text, nowIso(), projectId, id);
  return result.changes === 0 ? undefined : findTemplate(projectId, id);
}

export function deleteTemplate(projectId: string, id: string): boolean {
  const result = getDatabase()
    .prepare('DELETE FROM templates WHERE projectId = ? AND id = ?')
    .run(projectId, id);
  return result.changes > 0;
}
