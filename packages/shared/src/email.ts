import { z } from 'zod';
import { idSchema, contactQuerySchema } from './contacts.js';
const line = z
  .string()
  .trim()
  .max(500)
  .refine((v) => !/[\r\n]/.test(v), 'Use a single line');
export const sendingSettingsInputSchema = z.object({
  hourlyLimit: z.number().int().min(1).max(10000).default(60),
  timeZone: z.string().refine((v) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: v });
      return true;
    } catch {
      return false;
    }
  }, 'Invalid IANA time zone'),
}).strict();
export const sendingSettingsSchema = sendingSettingsInputSchema.extend({
  projectId: idSchema,
});
export const emailAccountInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  host: z.string().trim().min(1).max(253),
  port: z.number().int().min(1).max(65535),
  tlsMode: z.enum(['tls', 'starttls', 'none']),
  username: line.default(''),
  password: z.string().max(2000).default(''),
  senderName: line.default(''),
  senderEmail: z.email(),
  replyTo: z.union([z.email(), z.literal('')]).default(''),
}).strict();
export const incomingInputSchema = z.object({
  enabled: z.boolean(), host: z.string().trim().max(253).default(''),
  port: z.number().int().min(1).max(65535).default(993),
  tlsMode: z.enum(['tls', 'starttls', 'none']).default('tls'),
  useSmtpCredentials: z.boolean().default(true), username: line.default(''),
  password: z.string().max(2000).default(''),
}).strict().refine(v => !v.enabled || Boolean(v.host), 'Enter an IMAP host.');
export const incomingSchema = z.object(incomingInputSchema.shape).omit({ password: true }).extend({ passwordConfigured: z.boolean() });
export type IncomingInput = z.infer<typeof incomingInputSchema>;
export const inboxIdentitySchema = z.object({ uidValidity: z.string().regex(/^[1-9]\d{0,19}$/), uid: z.coerce.number().int().min(1).max(4294967295) }).strict();
export const inboxQuerySchema = z.object({ page: z.coerce.number().int().min(1).max(1000000).default(1) }).strict();
export const inboxHeaderSchema = inboxIdentitySchema.extend({
  accountId: idSchema, from: z.string(), subject: z.string(), date: z.string().nullable(), unread: z.boolean(),
});
export const inboxListSchema = z.object({ accountId: idSchema, uidValidity: z.string(), total: z.number(), page: z.number(), items: z.array(inboxHeaderSchema) });
export const inboxMessageSchema = inboxHeaderSchema.extend({ html: z.string(), text: z.string(), recipient: z.string(), messageId: z.string(), references: z.array(z.string()) });
export const replyContextSchema = z.object({
  accountId: idSchema, uidValidity: z.string(), uid: z.number(), recipient: z.email(),
  messageId: z.string(), references: z.array(z.string()), subject: z.string(), from: z.string(), text: z.string(),
});
export const emailAccountSchema = emailAccountInputSchema
  .omit({ password: true })
  .extend({
    id: idSchema,
    projectId: idSchema,
    passwordConfigured: z.boolean(),
    incoming: incomingSchema.nullable().default(null),
    sendingError: z.string(),
  });
export type EmailAccountInput = z.infer<typeof emailAccountInputSchema>;
export type EmailAccount = z.infer<typeof emailAccountSchema>;
export const templateInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    subject: line.min(1),
    html: z.string().min(1).max(100000),
  })
  .strict();
export const templateSchema = templateInputSchema.extend({
  id: idSchema,
  projectId: idSchema,
  text: z.string(),
});
export const audienceSchema = z
  .object({
    mode: z.enum(['all', 'selected', 'filters']).default('all'),
    contactIds: z.array(idSchema).max(10000).default([]),
    filters: contactQuerySchema.default(() => contactQuerySchema.parse({})),
  })
  .strict();
export const campaignMessageInputSchema = templateInputSchema.omit({ name: true });
export const campaignContentSchema = z
  .object({
    templateId: idSchema.nullable().default(null),
    message: campaignMessageInputSchema.nullable().default(null),
  })
  .strict()
  .refine(
    (v) => Boolean(v.templateId) !== Boolean(v.message),
    'Choose a template or write an email.',
  );
export const campaignInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    ...campaignContentSchema.shape,
    emailAccountId: idSchema,
    audience: audienceSchema,
    scheduledAt: z.iso.datetime().nullable().default(null),
    weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    startHour: z.number().int().min(0).max(23).nullable().default(null),
    endHour: z.number().int().min(1).max(24).nullable().default(null),
  })
  .strict()
  .refine(
    (v) => Boolean(v.templateId) !== Boolean(v.message),
    'Choose a template or write an email.',
  )
  .refine(
    (v) =>
      (v.startHour === null && v.endHour === null) ||
      (v.startHour !== null && v.endHour !== null && v.startHour < v.endHour),
    'Choose a start hour before the end hour',
  );
export const campaignStates = [
  'draft',
  'preparing',
  'preparation_failed',
  'scheduled',
  'active',
  'paused',
  'cancelled',
  'completed',
] as const;
export const recipientStates = [
  'queued',
  'claimed',
  'sending',
  'smtp_accepted',
  'failed',
  'skipped',
  'outcome_unknown',
] as const;
export const campaignSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  name: z.string(),
  templateId: idSchema.nullable().default(null),
  message: campaignMessageInputSchema.nullable().default(null),
  emailAccountId: idSchema.nullable().default(null),
  senderEmail: z.string().default(''),
  audience: audienceSchema,
  scheduledAt: z.string().nullable(),
  weekdays: z.array(z.number()),
  startHour: z.number().nullable(),
  endHour: z.number().nullable(),
  state: z.enum(campaignStates),
  error: z.string(),
  timeZone: z.string(),
  total: z.number(),
});
export const previewSchema = z.object({
  projectId: idSchema,
  subject: z.string(),
  html: z.string(),
  text: z.string(),
  warnings: z.array(z.string()),
});
export const audiencePreviewSchema = z.object({
  projectId: idSchema,
  eligible: z.number(),
  recipients: z
    .array(z.object({ contactId: idSchema, email: z.string() }))
    .default([]),
  excluded: z.number(),
  warnings: z.array(z.string()),
});
export const recipientSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  campaignId: idSchema,
  email: z.string(),
  state: z.enum(recipientStates),
  reason: z.string(),
  attempts: z.array(
    z.object({ at: z.string(), state: z.string(), reason: z.string() }),
  ),
});
export const reportSchema = z.object({
  projectId: idSchema,
  items: z.array(recipientSchema),
  total: z.number(),
  counts: z.record(z.string(), z.number()),
});
export type TemplateInput = z.infer<typeof templateInputSchema>;
export type CampaignInput = z.infer<typeof campaignInputSchema>;

export type Campaign = z.infer<typeof campaignSchema>;
export type EmailTemplate = z.infer<typeof templateSchema>;

export const messageDraftInputSchema = z.object({
  subject: line.default(''),
  html: z.string().max(100000).default(''),
  emailAccountId: idSchema.nullable().default(null),
  contactIds: z.array(idSchema).max(10000).default([]),
  addresses: z.array(z.string().trim().max(320)).max(10000).default([]),
}).strict().refine(v => v.contactIds.length + v.addresses.length <= 10000, 'Maximum 10,000 recipients.');
export const messageSubmitSchema = z.object({ confirmed: z.literal(true), retry: z.boolean().default(false) }).strict();
export const messageSchema = messageDraftInputSchema.safeExtend({
  id: idSchema, projectId: idSchema, state: z.enum(campaignStates),
  kind: z.enum(['compose', 'reply']).default('compose'), replyContext: replyContextSchema.nullable().default(null),
  senderEmail: z.string(), total: z.number(), excluded: z.number(), error: z.string(),
  createdAt: z.string(),
});
export const messagePreviewSchema = z.object({
  projectId: idSchema, eligible: z.number(), excluded: z.number(),
  recipients: z.array(z.object({ email: z.string(), subject: z.string(), html: z.string(), text: z.string(), warnings: z.array(z.string()) })),
});
export const messageRecipientSchema = recipientSchema.omit({ campaignId: true }).extend({ messageId: idSchema });
export const messageReportSchema = z.object({ projectId: idSchema, items: z.array(messageRecipientSchema), total: z.number(), counts: z.record(z.string(), z.number()) });
export type MessageDraftInput = z.infer<typeof messageDraftInputSchema>;
export type StandaloneMessage = z.infer<typeof messageSchema>;
