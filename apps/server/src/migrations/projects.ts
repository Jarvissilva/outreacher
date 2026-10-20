import { ContactModel, FieldModel, ProjectModel } from '../models/index.js';

// Run before accepting requests or starting workers.
export async function migrateProjects() {
  await ProjectModel.createIndexes();
  const project = await ProjectModel.findOneAndUpdate(
    { isDefault: true },
    {
      $setOnInsert: {
        name: 'Default project',
        normalizedName: 'default project',
        isDefault: true,
      },
    },
    { upsert: true, returnDocument: 'after' },
  );
  for (const model of [ContactModel, FieldModel]) {
    await model.collection.updateMany(
      { $or: [{ projectId: { $exists: false } }, { projectId: null }] },
      { $set: { projectId: project._id } },
    );
  }
  // Establish scoped uniqueness before removing global uniqueness.
  await Promise.all([ContactModel.createIndexes(), FieldModel.createIndexes()]);
  for (const [collection, legacyKey] of [
    [ContactModel.collection, 'email'],
    [FieldModel.collection, 'key'],
  ] as const) {
    for (const index of await collection.indexes()) {
      if (
        index.name &&
        Object.keys(index.key).length === 1 &&
        legacyKey in index.key &&
        index.unique
      ) {
        await collection.dropIndex(index.name);
      }
      if (index.name && 'tagIds' in index.key)
        await collection.dropIndex(index.name);
    }
  }
  await ContactModel.collection.updateMany({}, { $unset: { tagIds: '' } });
  const db = ProjectModel.db.db;
  if (!db) throw new Error('Database is not connected.');
  if (await db.listCollections({ name: 'tags' }).hasNext())
    await db.collection('tags').drop();
}
