import { z } from 'zod';
import type { ProjectInput } from '@outreacher/shared';
import { getDatabase } from '../database.js';
import { newId, nowIso, toBoolean, toDate } from '../values.js';

const projectRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  normalizedName: z.string(),
  hourlyLimit: z.number().int(),
  timeZone: z.string(),
  nextSendAt: z.string(),
  isDefault: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
type ProjectRow = z.infer<typeof projectRowSchema>;

export interface Project {
  id: string;
  name: string;
  normalizedName: string;
  hourlyLimit: number;
  timeZone: string;
  nextSendAt: Date;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function fromRow(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    normalizedName: row.normalizedName,
    hourlyLimit: row.hourlyLimit,
    timeZone: row.timeZone,
    nextSendAt: toDate(row.nextSendAt),
    isDefault: toBoolean(row.isDefault),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
  };
}

export function listProjects(): Project[] {
  return getDatabase()
    .prepare('SELECT * FROM projects ORDER BY createdAt ASC, id ASC')
    .all()
    .map((row) => fromRow(projectRowSchema.parse(row)));
}

export function findProject(id: string): Project | undefined {
  const row = getDatabase().prepare('SELECT * FROM projects WHERE id = ?').get(id);
  return row === undefined ? undefined : fromRow(projectRowSchema.parse(row));
}

export function findDefaultProject(): Project | undefined {
  const row = getDatabase()
    .prepare('SELECT * FROM projects WHERE isDefault = 1')
    .get();
  return row === undefined ? undefined : fromRow(projectRowSchema.parse(row));
}

export function createProject(input: ProjectInput): Project {
  const id = newId();
  const now = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO projects
        (id, name, normalizedName, hourlyLimit, timeZone, nextSendAt, isDefault, createdAt, updatedAt)
       VALUES (?, ?, ?, 60, 'UTC', ?, 0, ?, ?)`,
    )
    .run(
      id,
      input.name,
      input.name.toLowerCase(),
      new Date(0).toISOString(),
      now,
      now,
    );
  const project = findProject(id);
  if (!project) throw new Error('Project creation failed.');
  return project;
}

export function updateProject(id: string, input: ProjectInput): Project | undefined {
  getDatabase()
    .prepare(
      'UPDATE projects SET name = ?, normalizedName = ?, updatedAt = ? WHERE id = ?',
    )
    .run(input.name, input.name.toLowerCase(), nowIso(), id);
  return findProject(id);
}

export function saveSendingSettings(
  id: string,
  input: { hourlyLimit: number; timeZone: string },
): Project | undefined {
  getDatabase()
    .prepare(
      'UPDATE projects SET hourlyLimit = ?, timeZone = ?, updatedAt = ? WHERE id = ?',
    )
    .run(input.hourlyLimit, input.timeZone, nowIso(), id);
  return findProject(id);
}

export function reserveSendSlot(
  id: string,
  claimTime: Date,
  nextSendAt: Date,
): boolean {
  const result = getDatabase()
    .prepare(
      'UPDATE projects SET nextSendAt = ?, updatedAt = ? WHERE id = ? AND nextSendAt <= ?',
    )
    .run(nextSendAt.toISOString(), nowIso(), id, claimTime.toISOString());
  return result.changes > 0;
}

export function markProjectDefault(id: string): void {
  getDatabase()
    .prepare('UPDATE projects SET isDefault = ?, updatedAt = ? WHERE id = ?')
    .run(1, nowIso(), id);
}

export function insertDefaultProject(): Project {
  const id = newId();
  const now = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO projects
        (id, name, normalizedName, hourlyLimit, timeZone, nextSendAt, isDefault, createdAt, updatedAt)
       VALUES (?, 'Default project', 'default project', 60, 'UTC', ?, 1, ?, ?)`,
    )
    .run(id, new Date(0).toISOString(), now, now);
  const project = findProject(id);
  if (!project) throw new Error('Default project creation failed.');
  return project;
}

export function serializeProject(
  project: Project,
  contactCount: number,
) {
  return {
    id: project.id,
    name: project.name,
    isDefault: project.isDefault,
    contactCount,
  };
}
