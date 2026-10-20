import assert from 'node:assert/strict';
import { it } from 'node:test';
import { campaignInputSchema, campaignSchema, campaignContentSchema } from '@outreachit/shared';
import { CampaignModel, serializeCampaign } from '../src/models/EmailModels.js';
const projectId = '111111111111111111111111';
const accountId = '222222222222222222222222';
const templateId = '333333333333333333333333';
const message = { subject: 'Hello {{firstName}}', html: '<p>Campaign email</p>' };
const base = { name: 'Campaign', emailAccountId: accountId, audience: { mode: 'all' } };
it('accepts a direct email without a template and preserves existing template inputs', () => {
  assert.equal(campaignInputSchema.parse({ ...base, message }).templateId, null);
  assert.equal(campaignInputSchema.parse({ ...base, templateId }).message, null);
});
it('requires exactly one email source for campaign saves and audience previews', () => {
  for (const content of [{}, { templateId, message }]) {
    assert.equal(campaignContentSchema.safeParse(content).success, false);
    assert.equal(campaignInputSchema.safeParse({ ...base, ...content }).success, false);
  }
  assert.equal(campaignInputSchema.safeParse({ ...base, message: { ...message, subject: '' } }).success, false);
});
it('serializes saved direct content and reads legacy template campaigns', () => {
  const direct = new CampaignModel({ projectId, ...base, message });
  const serialized = campaignSchema.parse(JSON.parse(JSON.stringify(serializeCampaign(direct))));
  assert.equal(serialized.templateId, null);
  assert.deepEqual(serialized.message, message);
  const legacy = new CampaignModel({ projectId, ...base, templateId });
  const old = campaignSchema.parse(JSON.parse(JSON.stringify(serializeCampaign(legacy))));
  assert.equal(old.templateId, templateId);
  assert.equal(old.message, null);
});
