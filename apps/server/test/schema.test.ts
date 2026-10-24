import assert from 'node:assert/strict';
import { after, before, it } from 'node:test';
import { z } from 'zod';
import { openDatabase, closeDatabase, getDatabase } from '../src/db/database.js';
import { migrate } from '../src/db/schema.js';
import { ensureDefaultProject } from '../src/db/bootstrap.js';
import { createProject, findDefaultProject } from '../src/db/repositories/projects.js';
import { createJob } from '../src/db/repositories/jobs.js';
import { newId } from '../src/db/values.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let directory = '';

before(() => {
  directory = mkdtempSync(join(tmpdir(), 'outreacher-schema-'));
  openDatabase(join(directory, 'schema.sqlite'));
});

after(() => {
  closeDatabase();
  rmSync(directory, { recursive: true, force: true });
});

it('applies the schema once and keeps migrations idempotent', () => {
  const db = getDatabase();
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => z.object({ name: z.string() }).parse(row).name);
  for (const table of [
    'projects',
    'contacts',
    'custom_fields',
    'mail_accounts',
    'templates',
    'campaigns',
    'messages',
    'recipient_jobs',
    'recipient_job_attempts',
    'migrations',
  ])
    assert.ok(tables.includes(table), table);
  assert.equal(
    z
      .object({ total: z.number().int() })
      .parse(db.prepare('SELECT COUNT(*) AS total FROM migrations').get()).total,
    1,
  );
  migrate(db);
  migrate(db);
  assert.equal(
    z
      .object({ total: z.number().int() })
      .parse(db.prepare('SELECT COUNT(*) AS total FROM migrations').get()).total,
    1,
  );
});

it('bootstraps a single default project and enforces its partial unique index', () => {
  const first = ensureDefaultProject();
  assert.equal(ensureDefaultProject().id, first.id);
  const second = createProject({ name: 'Second' });
  assert.equal(findDefaultProject()?.id, first.id);
  assert.throws(
    () =>
      getDatabase()
        .prepare('UPDATE projects SET isDefault = 1 WHERE id = ?')
        .run(second.id),
    /UNIQUE/,
  );
});

it('enforces per-source recipient uniqueness and the one-source check', () => {
  const projectId = ensureDefaultProject().id;
  const campaignId = newId();
  const contactId = newId();
  const base = {
    projectId,
    campaignId,
    contactId,
    preparationToken: newId(),
    email: 'person@example.com',
    subject: '',
    html: '',
    text: '',
  };
  createJob(base);
  assert.throws(() => createJob(base), /UNIQUE/);
  const now = new Date().toISOString();
  const insert = getDatabase().prepare(
    `INSERT INTO recipient_jobs
      (id, projectId, campaignId, messageId, contactId, preparationToken, email,
       state, availableAt, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, NULL, ?, 'x@example.com', 'queued', ?, ?, ?)`,
  );
  // A null contact is allowed more than once by the partial unique index.
  insert.run(newId(), projectId, newId(), null, newId(), now, now, now);
  insert.run(newId(), projectId, newId(), null, newId(), now, now, now);
  assert.throws(
    () => insert.run(newId(), projectId, null, null, newId(), now, now, now),
    /CHECK/,
  );
});
