import assert from 'node:assert/strict';
import { after, before, beforeEach, it } from 'node:test';
import {
  campaignInputSchema,
  campaignSchema,
  campaignContentSchema,
} from '@outreacher/shared';
import {
  createCampaign,
  serializeCampaign,
} from '../src/db/repositories/campaigns.js';
import { newId } from '../src/db/values.js';
import { resetTestDatabase, setupTestDatabase, teardownTestDatabase } from './support/database.js';

let projectId = '';
const accountId = newId();
const templateId = newId();
const message = { subject: 'Hello {{firstName}}', html: '<p>Campaign email</p>' };
const base = {
  name: 'Campaign',
  emailAccountId: accountId,
  audience: { mode: 'all' as const },
};

before(() => {
  setupTestDatabase();
});
beforeEach(() => {
  projectId = resetTestDatabase().id;
});
after(() => {
  teardownTestDatabase();
});

it('accepts a direct email without a template and preserves existing template inputs', () => {
  assert.equal(
    campaignInputSchema.parse({ ...base, message }).templateId,
    null,
  );
  assert.equal(
    campaignInputSchema.parse({ ...base, templateId }).message,
    null,
  );
});

it('requires exactly one email source for campaign saves and audience previews', () => {
  for (const content of [{}, { templateId, message }]) {
    assert.equal(campaignContentSchema.safeParse(content).success, false);
    assert.equal(
      campaignInputSchema.safeParse({ ...base, ...content }).success,
      false,
    );
  }
  assert.equal(
    campaignInputSchema.safeParse({
      ...base,
      message: { ...message, subject: '' },
    }).success,
    false,
  );
});

it('serializes saved direct content and reads legacy template campaigns', () => {
  const direct = createCampaign(
    projectId,
    campaignInputSchema.parse({ ...base, message }),
  );
  const serialized = campaignSchema.parse(serializeCampaign(direct));
  assert.equal(serialized.templateId, null);
  assert.deepEqual(serialized.message, message);
  const legacy = createCampaign(
    projectId,
    campaignInputSchema.parse({ ...base, templateId }),
  );
  const old = campaignSchema.parse(serializeCampaign(legacy));
  assert.equal(old.templateId, templateId);
  assert.equal(old.message, null);
});
