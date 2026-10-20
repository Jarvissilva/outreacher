import { z } from 'zod';

const text = (max = 160) => z.string().trim().max(max).default('');
export const idSchema = z
  .string()
  .regex(/^[a-f\d]{24}$/i, 'Invalid identifier');
export const fieldKeySchema = z
  .string()
  .trim()
  .regex(
    /^[a-z][a-z0-9_]{0,39}$/,
    'Use lowercase letters, numbers, and underscores; start with a letter',
  )
  .refine(
    (key) => !['constructor', 'prototype'].includes(key),
    'This key is reserved',
  );
export const projectInputSchema = z
  .object({ name: z.string().trim().min(1).max(80) })
  .strict();
export const fieldInputSchema = z
  .object({
    key: fieldKeySchema,
    label: z.string().trim().min(1).max(80),
  })
  .strict();
export const contactInputSchema = z
  .object({
    email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
    firstName: text(100),
    lastName: text(100),
    company: text(),
    phone: text(40),
    website: text(500).refine(
      (value) => !value || /^https?:\/\/[^\s]+$/i.test(value),
      'Use an http:// or https:// URL',
    ),
    city: text(100),
    state: text(100),
    country: text(100),
    source: text(100),
    notes: text(4000),
    customFields: z
      .record(fieldKeySchema, z.string().trim().max(1000))
      .default({}),
    suppressed: z.boolean().default(false),
  })
  .strict();
export type ContactInput = z.infer<typeof contactInputSchema>;
export type ProjectInput = z.infer<typeof projectInputSchema>;
export type FieldInput = z.infer<typeof fieldInputSchema>;

export const projectSchema = projectInputSchema.extend({
  id: idSchema,
  isDefault: z.boolean(),
  contactCount: z.number(),
});
export const projectsSchema = z.array(projectSchema);
export type Project = z.infer<typeof projectSchema>;
export const fieldSchema = fieldInputSchema.extend({
  id: idSchema,
  projectId: idSchema,
});
export const contactSchema = contactInputSchema.extend({
  id: idSchema,
  projectId: idSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Contact = z.infer<typeof contactSchema>;
export type CustomField = z.infer<typeof fieldSchema>;

export const contactQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().max(200).default(''),
    fieldKey: fieldKeySchema.optional(),
    fieldValue: z.string().trim().max(1000).default(''),
    status: z.enum(['all', 'active', 'suppressed']).default('all'),
  })
  .strict();
export const contactListSchema = z.object({
  projectId: idSchema,
  items: z.array(contactSchema),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
});
export const fieldsSchema = z.array(fieldSchema);
export const overviewSchema = z.object({
  contacts: z.number(),
  active: z.number(),
  suppressed: z.number(),
  projectId: idSchema,
});
export const errorSchema = z.object({
  error: z.object({
    message: z.string(),
    details: z.array(z.string()).optional(),
  }),
});

export const importRequestSchema = z
  .object({
    csv: z.string().min(1).max(1_000_000),
    mapping: z.record(z.string().max(60), z.string().max(200)),
  })
  .strict();
export type ImportRequest = z.infer<typeof importRequestSchema>;
export const importPreviewSchema = z.object({
  projectId: idSchema,
  total: z.number(),
  ready: z.number(),
  duplicates: z.number(),
  invalid: z.number(),
  rows: z.array(
    z.object({
      row: z.number(),
      email: z.string(),
      status: z.enum(['ready', 'duplicate', 'invalid']),
      issues: z.array(z.string()),
    }),
  ),
});
export const importResultSchema = z.object({
  projectId: idSchema,
  imported: z.number(),
  duplicates: z.number(),
  invalid: z.number(),
});
export const csvHeadersSchema = z.object({
  projectId: idSchema,
  headers: z.array(z.string()),
});
export const csvColumns = [
  'email',
  'firstName',
  'lastName',
  'company',
  'phone',
  'website',
  'city',
  'state',
  'country',
  'source',
  'notes',
] as const;
