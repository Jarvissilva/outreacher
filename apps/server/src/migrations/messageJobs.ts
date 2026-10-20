import { RecipientJobModel } from '../models/EmailModels.js';
// Run while older workers are stopped. Create replacements before dropping the legacy index.
export async function migrateMessageJobs() {
  if (await RecipientJobModel.exists({
    $or: [
      { campaignId: { $type: 'objectId' }, messageId: { $type: 'objectId' } },
      { campaignId: { $not: { $type: 'objectId' } }, messageId: { $not: { $type: 'objectId' } } },
    ]
  })) throw new Error('Recipient job ownership conflict.');
  await RecipientJobModel.createCollection();
  await RecipientJobModel.createIndexes();
  const indexes = await RecipientJobModel.collection.indexes();
  for (const index of indexes) {
    if (index.name && index.key.campaignId === 1 && index.key.contactId === 1 && !index.partialFilterExpression)
      await RecipientJobModel.collection.dropIndex(index.name);
  }
}
