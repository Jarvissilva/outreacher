import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import {
  contactListSchema,
  contactSchema,
  fieldsSchema,
  importPreviewSchema,
  importResultSchema,
  overviewSchema,
  projectSchema,
  projectsSchema,
} from '@outreachit/shared';
import { migrateProjects } from '../src/migrations/projects.js';
import { app } from '../src/app.js';
import { ContactModel, FieldModel, ProjectModel } from '../src/models/index.js';

let memory: MongoMemoryServer | undefined;
let testUri = '';
let projectId = '';
const scoped = (path: string) => `/api/projects/${projectId}${path}`;
const testDatabaseName = `outreachit_test_${randomUUID().replaceAll('-', '')}`;

before(async () => {
  testUri =
    process.env.TEST_MONGODB_URI ??
    (memory = await MongoMemoryServer.create()).getUri();
  await mongoose.connect(testUri, {
    dbName: testDatabaseName,
    autoIndex: false,
  });
  await migrateProjects();
});
beforeEach(async () => {
  await Promise.all([
    ContactModel.deleteMany({}),
    ProjectModel.deleteMany({}),
    FieldModel.deleteMany({}),
  ]);
  await migrateProjects();
  projectId = String((await ProjectModel.findOne({ isDefault: true }))?._id);
});
after(async () => {
  // Only the random test database created above is ever dropped.
  if (mongoose.connection.readyState === 1)
    await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await memory?.stop();
});

async function addContact(input: Record<string, unknown>) {
  const response = await request(app)
    .post(scoped('/contacts'))
    .send(input)
    .expect(201);
  return contactSchema.parse(response.body);
}
describe('Contact management', () => {
  it('normalizes email, persists edits, validates input, and rejects case-insensitive duplicates', async () => {
    const contact = await addContact({
      email: '  PERSON@example.com  ',
      firstName: 'Alex',
    });
    assert.equal(contact.email, 'person@example.com');
    assert.equal(contact.company, '');
    await request(app)
      .post(scoped('/contacts'))
      .send({ email: 'Person@example.com' })
      .expect(409);
    await request(app)
      .post(scoped('/contacts'))
      .send({ email: 'invalid' })
      .expect(400);
    await request(app)
      .post(scoped('/contacts'))
      .send({ email: 'other@example.com', unknown: true })
      .expect(400);
    await request(app)
      .put(scoped(`/contacts/${contact.id}`))
      .send({ email: contact.email, company: 'Example', suppressed: true })
      .expect(200);
    const list = contactListSchema.parse(
      (
        await request(app)
          .get(scoped('/contacts?status=suppressed'))
          .expect(200)
      ).body,
    );
    assert.equal(list.total, 1);
    assert.equal(list.items[0]?.company, 'Example');
    await request(app)
      .put(scoped('/contacts/not-an-id'))
      .send({ email: contact.email })
      .expect(400);
    await request(app)
      .delete(scoped(`/contacts/${new mongoose.Types.ObjectId()}`))
      .expect(404);
  });

  it('filters by search and custom values, escapes regex, and paginates deterministically', async () => {
    await request(app)
      .post(scoped('/custom-fields'))
      .send({ key: 'interest', label: 'Interest' })
      .expect(201);
    await addContact({
      email: 'one@example.com',
      firstName: 'Alex',
      company: 'A+B',
      customFields: { interest: 'Design' },
    });
    await addContact({ email: 'two@example.com', firstName: 'Sam' });
    const filtered = contactListSchema.parse(
      (
        await request(app)
          .get(scoped(`/contacts?fieldKey=interest&fieldValue=design`))
          .expect(200)
      ).body,
    );
    assert.equal(filtered.total, 1);
    assert.equal(filtered.items[0]?.email, 'one@example.com');
    const escaped = contactListSchema.parse(
      (
        await request(app)
          .get(scoped('/contacts'))
          .query({ search: 'A+B' })
          .expect(200)
      ).body,
    );
    assert.equal(escaped.total, 1);
    const first = contactListSchema.parse(
      (await request(app).get(scoped('/contacts?page=1&limit=1')).expect(200))
        .body,
    );
    const second = contactListSchema.parse(
      (await request(app).get(scoped('/contacts?page=2&limit=1')).expect(200))
        .body,
    );
    assert.equal(first.total, 2);
    assert.notEqual(first.items[0]?.id, second.items[0]?.id);
    await request(app).get(scoped('/contacts?page=0')).expect(400);
    await request(app).get(scoped('/contacts?fieldKey=unknown')).expect(404);
    await request(app).get(scoped('/contacts?search[$ne]=x')).expect(400);
  });

  it('preserves suppression through imports and deletion and reserves deleted emails', async () => {
    const contact = await addContact({
      email: 'skip@example.com',
      suppressed: true,
    });
    const input = {
      csv: 'email\nskip@example.com\nnew@example.com',
      mapping: { email: 'email' },
    };
    const first = importResultSchema.parse(
      (
        await request(app)
          .post(scoped('/contacts/import'))
          .send(input)
          .expect(201)
      ).body,
    );
    assert.deepEqual(first, {
      projectId,
      imported: 1,
      duplicates: 1,
      invalid: 0,
    });
    assert.equal((await ContactModel.findById(contact.id))?.suppressed, true);
    await request(app)
      .delete(scoped(`/contacts/${contact.id}`))
      .expect(204);
    const again = importResultSchema.parse(
      (
        await request(app)
          .post(scoped('/contacts/import'))
          .send(input)
          .expect(201)
      ).body,
    );
    assert.equal(again.imported, 0);
    assert.equal(again.duplicates, 2);
    await request(app)
      .post(scoped('/contacts'))
      .send({ email: contact.email })
      .expect(409);
    const list = contactListSchema.parse(
      (await request(app).get(scoped('/contacts')).expect(200)).body,
    );
    assert.equal(list.total, 1);
  });

  it('uses unique indexes when the same email is created concurrently', async () => {
    const results = await Promise.all(
      [1, 2].map(() =>
        request(app)
          .post(scoped('/contacts'))
          .send({ email: 'race@example.com' }),
      ),
    );
    assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
    assert.equal(await ContactModel.countDocuments(), 1);
  });
});

describe('Custom fields', () => {
  it('supports stable custom keys, rejects unknown/reserved keys, and protects existing values', async () => {
    const fieldResponse = await request(app)
      .post(scoped('/custom-fields'))
      .send({ key: 'interest', label: 'Interest' })
      .expect(201);
    const field = fieldsSchema.parse([fieldResponse.body])[0];
    assert.ok(field);
    await request(app)
      .post(scoped('/custom-fields'))
      .send({ key: 'constructor', label: 'Bad' })
      .expect(400);
    await request(app)
      .post(scoped('/custom-fields'))
      .send({ key: 'bad.key', label: 'Bad' })
      .expect(400);
    await request(app)
      .put(scoped(`/custom-fields/${field.id}`))
      .send({ key: 'renamed', label: 'Renamed' })
      .expect(400);
    const contact = await addContact({
      email: 'custom@example.com',
      customFields: { interest: 'Art' },
    });
    assert.equal(contact.customFields.interest, 'Art');
    await request(app)
      .delete(scoped(`/custom-fields/${field.id}`))
      .expect(409);
    await request(app)
      .post(scoped('/contacts'))
      .send({
        email: 'unknown@example.com',
        customFields: { missing: 'Value' },
      })
      .expect(400);
    await request(app)
      .put(scoped(`/contacts/${contact.id}`))
      .send({ email: contact.email, customFields: { interest: '' } })
      .expect(200);
    await request(app)
      .delete(scoped(`/custom-fields/${field.id}`))
      .expect(204);
    assert.deepEqual(
      fieldsSchema.parse(
        (await request(app).get(scoped('/custom-fields'))).body,
      ),
      [],
    );
  });
});

describe('CSV imports and reporting', () => {
  it('previews mapped CSV with quoted values, duplicates, invalid rows, custom fields', async () => {
    await request(app)
      .post(scoped('/custom-fields'))
      .send({ key: 'interest', label: 'Interest' });
    const input = {
      csv: '\uFEFFEmail,First,Interest\nONE@example.com,"Alex, Jr",Design\none@example.com,Duplicate,Art\nnot-an-email,Bad,Art\ntwo@example.com,Sam,Music',
      mapping: {
        email: 'Email',
        firstName: 'First',
        'custom.interest': 'Interest',
      },
    };
    const preview = importPreviewSchema.parse(
      (
        await request(app)
          .post(scoped('/contacts/import/preview'))
          .send(input)
          .expect(200)
      ).body,
    );
    assert.equal(preview.ready, 2);
    assert.equal(preview.duplicates, 1);
    assert.equal(preview.invalid, 1);
    assert.equal(await ContactModel.countDocuments(), 0);
    const result = importResultSchema.parse(
      (
        await request(app)
          .post(scoped('/contacts/import'))
          .send(input)
          .expect(201)
      ).body,
    );
    assert.deepEqual(result, {
      projectId,
      imported: 2,
      duplicates: 1,
      invalid: 1,
    });
    const contact = await ContactModel.findOne({ email: 'one@example.com' });
    assert.equal(contact?.firstName, 'Alex, Jr');
    assert.equal(contact?.customFields.get('interest'), 'Design');
    const summary = overviewSchema.parse(
      (await request(app).get(scoped('/overview'))).body,
    );
    assert.deepEqual(summary, {
      contacts: 2,
      active: 2,
      suppressed: 0,
      projectId,
    });
  });

  it('rejects malformed files, invalid mappings, excessive rows, and invalid JSON', async () => {
    for (const csv of [
      'email,email\none@example.com,two@example.com',
      'email\n"unterminated',
      'email',
      'email\none@example.com,extra',
    ]) {
      await request(app)
        .post(scoped('/contacts/import/headers'))
        .send({ csv })
        .expect(400);
    }
    const csv = 'email\none@example.com';
    await request(app)
      .post(scoped('/contacts/import'))
      .send({ csv, mapping: {} })
      .expect(400);
    await request(app)
      .post(scoped('/contacts/import'))
      .send({ csv, mapping: { email: 'missing' } })
      .expect(400);
    await request(app)
      .post(scoped('/contacts/import'))
      .send({ csv, mapping: { email: 'email', 'custom.unknown': 'email' } })
      .expect(400);
    await request(app)
      .post(scoped('/contacts/import/headers'))
      .send({
        csv: `email\n${Array.from({ length: 2001 }, (_, index) => `user${index}@example.com`).join('\n')}`,
      })
      .expect(400);
    await request(app)
      .post(scoped('/contacts'))
      .set('Content-Type', 'application/json')
      .send('{bad')
      .expect(400);
    await request(app).get('/api/missing').expect(404);
  });

  it('reports actual database readiness', async () => {
    const response = await request(app).get('/api/health').expect(200);
    assert.deepEqual(response.body, { status: 'ok', database: 'connected' });
  });

  it('reports outages and preserves contacts after reconnection', async () => {
    const contact = await addContact({ email: 'persistent@example.com' });
    await mongoose.disconnect();
    try {
      const health = await request(app).get('/api/health').expect(503);
      assert.deepEqual(health.body, {
        status: 'error',
        database: 'disconnected',
      });
      await request(app).get(scoped('/contacts')).expect(503);
    } finally {
      await mongoose.connect(testUri, {
        dbName: testDatabaseName,
        autoIndex: false,
      });
    }
    const list = contactListSchema.parse(
      (await request(app).get(scoped('/contacts')).expect(200)).body,
    );
    assert.equal(list.items[0]?.id, contact.id);
  });
});

async function addProject(name: string) {
  const response = await request(app)
    .post('/api/projects')
    .send({ name })
    .expect(201);
  return projectSchema.parse(response.body);
}

describe('Project organization and isolation', () => {
  it('creates and renames unique case-insensitive projects and validates identifiers', async () => {
    const project = await addProject('  Research  ');
    assert.equal(project.name, 'Research');
    await request(app)
      .post('/api/projects')
      .send({ name: 'research' })
      .expect(409);
    await request(app).post('/api/projects').send({ name: ' ' }).expect(400);
    await request(app)
      .post('/api/projects')
      .send({ name: 'x', isDefault: true })
      .expect(400);
    await request(app)
      .put(`/api/projects/${project.id}`)
      .send({ name: 'Outreach' })
      .expect(200);
    await request(app)
      .put(`/api/projects/${project.id}`)
      .send({ name: 'DEFAULT PROJECT' })
      .expect(409);
    await request(app)
      .put('/api/projects/bad')
      .send({ name: 'Name' })
      .expect(400);
    await request(app)
      .put(`/api/projects/${new mongoose.Types.ObjectId()}`)
      .send({ name: 'Name' })
      .expect(404);
    await request(app).get('/api/projects/bad/contacts').expect(400);
    await request(app)
      .get(`/api/projects/${new mongoose.Types.ObjectId()}/contacts`)
      .expect(404);
    await request(app)
      .put(`/api/projects/${projectId}`)
      .send({ name: 'Renamed default' })
      .expect(200);
    await migrateProjects();
    const projects = projectsSchema.parse(
      (await request(app).get('/api/projects').expect(200)).body,
    );
    assert.equal(projects.length, 2);
    assert.equal(projects.find((project) => project.isDefault)?.id, projectId);
    assert.equal(
      projects.find((entry) => entry.id === project.id)?.name,
      'Outreach',
    );
    for (const path of [
      '/api/contacts',
      '/api/custom-fields',
      '/api/overview',
      '/api/tags',
    ]) {
      await request(app).get(path).expect(404);
      await request(app)
        .post(path)
        .send({ email: 'x@example.com' })
        .expect(404);
    }
  });

  it('isolates contacts, counts, suppression, deletion, imports, and duplicate reservations', async () => {
    const other = await addProject('Other');
    const otherPath = (path: string) => `/api/projects/${other.id}${path}`;
    const contact = await addContact({
      email: 'same@example.com',
      suppressed: true,
    });
    const second = contactSchema.parse(
      (
        await request(app)
          .post(otherPath('/contacts'))
          .send({ email: contact.email })
          .expect(201)
      ).body,
    );
    assert.equal(second.projectId, other.id);
    assert.equal(second.suppressed, false);
    await request(app)
      .put(otherPath(`/contacts/${contact.id}`))
      .send({ email: contact.email })
      .expect(404);
    await request(app)
      .put(otherPath(`/contacts/${contact.id}`))
      .send({ email: contact.email, customFields: { unknown: 'x' } })
      .expect(404);
    await request(app)
      .delete(otherPath(`/contacts/${contact.id}`))
      .expect(404);
    assert.equal(
      contactListSchema.parse(
        (await request(app).get(otherPath('/contacts?status=suppressed'))).body,
      ).total,
      0,
    );
    await request(app)
      .delete(scoped(`/contacts/${contact.id}`))
      .expect(204);
    const input = {
      csv: 'email\nsame@example.com\nnew@example.com',
      mapping: { email: 'email' },
    };
    const preview = importPreviewSchema.parse(
      (
        await request(app)
          .post(scoped('/contacts/import/preview'))
          .send(input)
          .expect(200)
      ).body,
    );
    assert.equal(preview.duplicates, 1);
    await request(app).post(scoped('/contacts/import')).send(input).expect(201);
    const otherImport = importResultSchema.parse(
      (
        await request(app)
          .post(otherPath('/contacts/import'))
          .send({ csv: 'email\nnew@example.com', mapping: { email: 'email' } })
          .expect(201)
      ).body,
    );
    assert.equal(otherImport.imported, 1);
    assert.equal((await ContactModel.findById(contact.id))?.suppressed, true);
    const directory = projectsSchema.parse(
      (await request(app).get('/api/projects')).body,
    );
    assert.equal(
      directory.find((project) => project.id === projectId)?.contactCount,
      1,
    );
    assert.equal(
      directory.find((project) => project.id === other.id)?.contactCount,
      2,
    );
    assert.equal(
      overviewSchema.parse(
        (await request(app).get(otherPath('/overview'))).body,
      ).contacts,
      2,
    );
    assert.equal(
      contactListSchema.parse(
        (await request(app).get(scoped('/contacts?search=same'))).body,
      ).total,
      0,
    );
  });

  it('isolates field definitions, references, filters, edits, and cleanup', async () => {
    const other = await addProject('Other');
    const otherPath = (path: string) => `/api/projects/${other.id}${path}`;
    const field = fieldsSchema.parse([
      (
        await request(app)
          .post(scoped('/custom-fields'))
          .send({ key: 'interest', label: 'Interest' })
          .expect(201)
      ).body,
    ])[0];
    assert.ok(field);
    assert.equal(field.projectId, projectId);
    await request(app)
      .post(scoped('/custom-fields'))
      .send({ key: 'interest', label: 'Duplicate' })
      .expect(409);
    await request(app)
      .put(otherPath(`/custom-fields/${field.id}`))
      .send({ key: field.key, label: 'Wrong' })
      .expect(404);
    await request(app)
      .delete(otherPath(`/custom-fields/${field.id}`))
      .expect(404);
    assert.deepEqual(
      fieldsSchema.parse(
        (await request(app).get(otherPath('/custom-fields'))).body,
      ),
      [],
    );
    await request(app)
      .get(otherPath('/contacts?fieldKey=interest&fieldValue=Art'))
      .expect(404);
    await request(app)
      .post(otherPath('/contacts'))
      .send({ email: 'x@example.com', customFields: { interest: 'Art' } })
      .expect(400);
    const input = {
      csv: 'email,value\nx@example.com,Art',
      mapping: { email: 'email', 'custom.interest': 'value' },
    };
    await request(app)
      .post(otherPath('/contacts/import/preview'))
      .send(input)
      .expect(400);
    await request(app)
      .post(otherPath('/contacts/import'))
      .send(input)
      .expect(400);
    const otherField = fieldsSchema.parse([
      (
        await request(app)
          .post(otherPath('/custom-fields'))
          .send({ key: field.key, label: 'Other interest' })
          .expect(201)
      ).body,
    ])[0];
    assert.ok(otherField);
    await request(app)
      .post(otherPath('/contacts/import'))
      .send(input)
      .expect(201);
    const filtered = contactListSchema.parse(
      (
        await request(app)
          .get(scoped('/contacts?fieldKey=interest&fieldValue=Art'))
          .expect(200)
      ).body,
    );
    assert.equal(filtered.total, 0);
    // Values in another project must neither block deletion nor be removed by it.
    await request(app)
      .delete(scoped(`/custom-fields/${field.id}`))
      .expect(204);
    const contacts = contactListSchema.parse(
      (await request(app).get(otherPath('/contacts'))).body,
    );
    assert.equal(contacts.items[0]?.customFields.interest, 'Art');
    await request(app)
      .delete(otherPath(`/custom-fields/${otherField.id}`))
      .expect(409);
  });

  it('migrates legacy data and indexes idempotently without changing suppression and removes legacy tags', async () => {
    await Promise.all([
      ContactModel.deleteMany({}),
      FieldModel.deleteMany({}),
      ProjectModel.deleteMany({}),
    ]);
    await ContactModel.collection.createIndex({ email: 1 }, { unique: true });
    await ContactModel.collection.createIndex({ deletedAt: 1, tagIds: 1 });
    await FieldModel.collection.createIndex({ key: 1 }, { unique: true });
    const tagId = new mongoose.Types.ObjectId();
    const db = mongoose.connection.db;
    assert.ok(db);
    await db.collection('tags').insertOne({ _id: tagId, name: 'Legacy' });
    const deleted = await ContactModel.collection.insertOne({
      email: 'legacy@example.com',
      suppressed: true,
      deletedAt: new Date(),
      tagIds: [tagId],
    });
    const active = await ContactModel.collection.insertOne({
      email: 'active@example.com',
      suppressed: false,
      deletedAt: null,
    });
    await FieldModel.collection.insertOne({ key: 'legacy', label: 'Legacy' });
    await migrateProjects();
    const project = await ProjectModel.findOne({ isDefault: true });
    assert.ok(project);
    const legacy = await ContactModel.collection.findOne({
      _id: deleted.insertedId,
    });
    assert.equal(String(legacy?.projectId), String(project._id));
    assert.equal(legacy?.suppressed, true);
    assert.ok(legacy?.deletedAt);
    const raw = await db
      .collection('contacts')
      .findOne({ _id: deleted.insertedId });
    assert.equal(raw?.tagIds, undefined);
    assert.equal(await db.listCollections({ name: 'tags' }).hasNext(), false);
    assert.equal(
      String((await ContactModel.findById(active.insertedId))?.projectId),
      String(project._id),
    );
    assert.equal(
      String((await FieldModel.findOne({ key: 'legacy' }))?.projectId),
      String(project._id),
    );
    for (const [collection, key] of [
      [ContactModel.collection, 'email'],
      [FieldModel.collection, 'key'],
    ] as const) {
      const indexes = await collection.indexes();
      assert.ok(
        indexes.some(
          (index) =>
            index.unique && 'projectId' in index.key && key in index.key,
        ),
      );
      assert.ok(
        !indexes.some(
          (index) =>
            index.unique &&
            Object.keys(index.key).length === 1 &&
            key in index.key,
        ),
      );
    }
    await migrateProjects();
    assert.equal(await ProjectModel.countDocuments(), 1);
    assert.equal(await ContactModel.countDocuments(), 2);
    assert.equal(await FieldModel.countDocuments(), 1);
    projectId = String(project._id);
    await request(app)
      .post(scoped('/contacts'))
      .send({ email: 'legacy@example.com' })
      .expect(409);
    const other = await addProject('After migration');
    await request(app)
      .post(`/api/projects/${other.id}/contacts`)
      .send({ email: 'legacy@example.com' })
      .expect(201);
  });
});
