import mongoose, { Schema } from 'mongoose';
const projectId = {
  type: Schema.Types.ObjectId,
  required: true,
  ref: 'Project',
};
const mailAccountSchema = new Schema(
  {
    projectId,
    name: { type: String, default: 'Mail account' },
    archivedAt: { type: Date, default: null },
    host: String,
    port: Number,
    tlsMode: String,
    username: String,
    passwordEncrypted: { type: String, default: '' },
    senderName: String,
    senderEmail: String,
    replyTo: String,
    incoming: { type: new Schema({
      enabled: Boolean, host: String, port: Number, tlsMode: String,
      useSmtpCredentials: Boolean, username: String, passwordEncrypted: { type: String, default: '' },
    }, { _id: false }), default: null },
    sendingError: { type: String, default: '' },
  },
  { timestamps: true },
);
mailAccountSchema.index({ projectId: 1, archivedAt: 1 });
export const MailAccountModel = mongoose.model('MailAccount', mailAccountSchema);
const templateSchema = new Schema(
  {
    projectId,
    name: { type: String, required: true },
    subject: { type: String, required: true },
    html: { type: String, required: true },
    text: { type: String, required: true },
  },
  { timestamps: true },
);
templateSchema.index({ projectId: 1 });
export const TemplateModel = mongoose.model('Template', templateSchema);
const campaignFields = {
  projectId,
  name: { type: String, required: true },
  templateId: { type: Schema.Types.ObjectId, default: null },
  message: {
    type: new Schema(
      { subject: String, html: String, text: String },
      { _id: false },
    ),
    default: null,
  },
  emailAccountId: { type: Schema.Types.ObjectId, default: null },
  audience: {
    mode: { type: String, default: 'all' },
    contactIds: [String],
    filters: {
      search: String,
      fieldKey: String,
      fieldValue: String,
      status: String,
    },
  },
  scheduledAt: { type: Date, default: null },
  weekdays: [Number],
  startHour: { type: Number, default: null },
  endHour: { type: Number, default: null },
  state: { type: String, default: 'draft' },
  error: { type: String, default: '' },
  timeZone: { type: String, default: 'UTC' },
  senderName: String,
  senderEmail: String,
  replyTo: String,
  total: { type: Number, default: 0 },
  preparationToken: String,
  preparationUntil: Date,
  startedAt: { type: Date, default: null },
};
const campaignSchema = new Schema(campaignFields, { timestamps: true });
campaignSchema.index({ projectId: 1, state: 1 });
export const CampaignModel = mongoose.model('Campaign', campaignSchema);
const jobSchema = new Schema(
  {
    projectId,
    campaignId: { type: Schema.Types.ObjectId, default: undefined },
    messageId: { type: Schema.Types.ObjectId, default: undefined },
    contactId: { type: Schema.Types.ObjectId, default: undefined },
    inReplyTo: String, references: [String],
    preparationToken: String,
    email: { type: String, required: true },
    subject: String,
    html: String,
    text: String,
    unsubscribeUrl: String,
    state: { type: String, default: 'queued' },
    reason: { type: String, default: '' },
    availableAt: { type: Date, default: Date.now },
    leaseUntil: Date,
    leaseToken: String,
    attempts: [
      {
        _id: false,
        at: { type: Date, required: true },
        state: { type: String, required: true },
        reason: { type: String, default: '' },
      },
    ],
  },
  { timestamps: true },
);
jobSchema.pre('validate', async function() {
  if (!this.contactId) {
    const message = this.messageId ? await MessageModel.findOne({ _id: this.messageId, projectId: this.projectId, kind: 'reply', state: 'preparing', preparationToken: this.preparationToken }) : null;
    if (!message?.replyContext || message.replyContext.recipient !== this.email || String(message.replyContext.accountId) !== String(message.emailAccountId))
      throw new Error('Only validated replies may omit a contact.');
  }
  if (Boolean(this.campaignId) === Boolean(this.messageId))
    throw new Error('A recipient job must belong to exactly one campaign or message.');
});
jobSchema.index({ campaignId: 1, contactId: 1 }, { unique: true, partialFilterExpression: { campaignId: { $type: 'objectId' } }, name: 'campaign_recipient' });
jobSchema.index({ messageId: 1, contactId: 1 }, { unique: true, partialFilterExpression: { messageId: { $type: 'objectId' } }, name: 'message_recipient' });
jobSchema.index({ projectId: 1, messageId: 1, state: 1, availableAt: 1 });
jobSchema.index({ projectId: 1, campaignId: 1, state: 1, availableAt: 1 });
export const RecipientJobModel = mongoose.model('RecipientJob', jobSchema);
const messageSchema = new Schema({
  kind: { type: String, enum: ['compose', 'reply'], default: 'compose', immutable: true },
  replyContext: { type: new Schema({
    accountId: { type: Schema.Types.ObjectId, required: true }, uidValidity: String, uid: Number,
    recipient: String, messageId: String, references: [String], subject: String, from: String, text: String,
  }, { _id: false }), default: null, immutable: true },
  ...campaignFields, name: { type: String, default: '' },
  subject: { type: String, default: '' }, html: { type: String, default: '' },
  contactIds: [String], addresses: [String], excluded: { type: Number, default: 0 },
}, { timestamps: true });
messageSchema.index({ projectId: 1, state: 1, createdAt: -1 });
export const MessageModel = mongoose.model('Message', messageSchema);
export function serializeMessage(m: InstanceType<typeof MessageModel>) {
  return {
    kind: m.kind ?? 'compose', replyContext: m.replyContext ? { accountId: String(m.replyContext.accountId), uidValidity: m.replyContext.uidValidity, uid: m.replyContext.uid, recipient: m.replyContext.recipient, messageId: m.replyContext.messageId ?? '', references: m.replyContext.references, subject: m.replyContext.subject ?? '', from: m.replyContext.from ?? '', text: m.replyContext.text ?? '' } : null,
    id: String(m._id), projectId: String(m.projectId), subject: m.subject ?? '', html: m.html ?? '',
    emailAccountId: m.emailAccountId ? String(m.emailAccountId) : null,
    contactIds: m.contactIds ?? [], addresses: m.addresses ?? [],
    state: m.state, senderEmail: m.senderEmail ?? '', total: m.total, excluded: m.excluded ?? 0,
    error: m.error, createdAt: m.createdAt.toISOString()
  };
}
export async function createEmailIndexes() {
  for (const model of [
    MailAccountModel,
    TemplateModel,
    CampaignModel,
    RecipientJobModel,
    MessageModel,
  ])
    await model.createIndexes();
}
export function serializeTemplate(t: InstanceType<typeof TemplateModel>) {
  return {
    id: String(t._id),
    projectId: String(t.projectId),
    name: t.name,
    subject: t.subject,
    html: t.html,
    text: t.text,
  };
}
export function serializeCampaign(c: InstanceType<typeof CampaignModel>) {
  return {
    id: String(c._id),
    projectId: String(c.projectId),
    name: c.name,
    templateId: c.templateId ? String(c.templateId) : null,
    message: c.message
      ? { subject: c.message.subject ?? '', html: c.message.html ?? '' }
      : null,
    emailAccountId: c.emailAccountId ? String(c.emailAccountId) : null,
    senderEmail: c.senderEmail ?? '',
    audience: {
      mode: c.audience?.mode ?? 'all',
      contactIds: c.audience?.contactIds ?? [],
      filters: c.audience?.filters ?? {},
    },
    scheduledAt: c.scheduledAt?.toISOString() ?? null,
    weekdays: c.weekdays,
    startHour: c.startHour,
    endHour: c.endHour,
    state: c.state,
    error: c.error,
    timeZone: c.timeZone,
    total: c.total,
  };
}
