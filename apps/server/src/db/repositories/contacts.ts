import { z } from 'zod';
import type { ContactInput } from '@outreacher/shared';
import { getDatabase } from '../database.js';
import {
  fromBoolean,
  jsonObject,
  newId,
  nowIso,
  toBoolean,
  toDate,
  toNullableDate,
} from '../values.js';

const contactRowSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  company: z.string(),
  phone: z.string(),
  website: z.string(),
  city: z.string(),
  state: z.string(),
  country: z.string(),
  source: z.string(),
  notes: z.string(),
  customFields: z.string(),
  suppressed: z.number().int(),
  deletedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
type ContactRow = z.infer<typeof contactRowSchema>;

export interface Contact {
  id: string;
  projectId: string;
  email: string;
  firstName: string;
  lastName: string;
  company: string;
  phone: string;
  website: string;
  city: string;
  state: string;
  country: string;
  source: string;
  notes: string;
  customFields: Record<string, string>;
  suppressed: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContactQuery {
  page: number;
  limit: number;
  search: string;
  fieldKey?: string | undefined;
  fieldValue: string;
  status: 'all' | 'active' | 'suppressed';
}

export interface ContactAudience {
  mode: 'all' | 'selected' | 'filters';
  contactIds: string[];
  filters: ContactQuery;
}

const contactColumns = [
  'id',
  'projectId',
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
  'customFields',
  'suppressed',
  'deletedAt',
  'createdAt',
  'updatedAt',
] as const;

function fromRow(row: ContactRow): Contact {
  return {
    id: row.id,
    projectId: row.projectId,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    company: row.company,
    phone: row.phone,
    website: row.website,
    city: row.city,
    state: row.state,
    country: row.country,
    source: row.source,
    notes: row.notes,
    customFields: jsonObject(row.customFields),
    suppressed: toBoolean(row.suppressed),
    deletedAt: toNullableDate(row.deletedAt),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
  };
}

export function serializeContact(contact: Contact) {
  return {
    id: contact.id,
    email: contact.email,
    firstName: contact.firstName,
    lastName: contact.lastName,
    company: contact.company,
    phone: contact.phone,
    website: contact.website,
    city: contact.city,
    state: contact.state,
    country: contact.country,
    source: contact.source,
    notes: contact.notes,
    projectId: contact.projectId,
    customFields: contact.customFields,
    suppressed: contact.suppressed,
    createdAt: contact.createdAt.toISOString(),
    updatedAt: contact.updatedAt.toISOString(),
  };
}

const escapeLike = (value: string) =>
  value.toLowerCase().replace(/[\\%_]/g, (character) => `\\${character}`);
const contains = (value: string) => `%${escapeLike(value)}%`;

function filterClause(
  projectId: string,
  query: ContactQuery,
): { sql: string; params: string[] } {
  const clauses = ['projectId = ?', 'deletedAt IS NULL'];
  const params = [projectId];
  if (query.status !== 'all') {
    clauses.push('suppressed = ?');
    params.push(String(query.status === 'suppressed' ? 1 : 0));
  }
  if (query.fieldKey) {
    clauses.push(`lower(json_extract(customFields, ?)) LIKE ? ESCAPE '\\'`);
    params.push(`$."${query.fieldKey}"`, contains(query.fieldValue));
  }
  if (query.search) {
    clauses.push(
      `(${['email', 'firstName', 'lastName', 'company', 'city', 'source']
        .map((column) => `lower(${column}) LIKE ? ESCAPE '\\'`)
        .join(' OR ')})`,
    );
    for (let index = 0; index < 6; index += 1) params.push(contains(query.search));
  }
  return { sql: clauses.join(' AND '), params };
}

export function listContacts(
  projectId: string,
  query: ContactQuery,
): { items: Contact[]; total: number } {
  const filter = filterClause(projectId, query);
  const rows = getDatabase()
    .prepare(
      `SELECT ${contactColumns.join(', ')} FROM contacts
       WHERE ${filter.sql}
       ORDER BY createdAt DESC, id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...filter.params, query.limit, (query.page - 1) * query.limit);
  const count = getDatabase()
    .prepare(`SELECT COUNT(*) AS total FROM contacts WHERE ${filter.sql}`)
    .get(...filter.params);
  const total = z.object({ total: z.number().int() }).parse(count).total;
  return { items: rows.map((row) => fromRow(contactRowSchema.parse(row))), total };
}

export function countContacts(projectId: string): number {
  const row = getDatabase()
    .prepare(
      'SELECT COUNT(*) AS total FROM contacts WHERE projectId = ? AND deletedAt IS NULL',
    )
    .get(projectId);
  return z.object({ total: z.number().int() }).parse(row).total;
}

export function countSuppressedContacts(projectId: string): number {
  const row = getDatabase()
    .prepare(
      'SELECT COUNT(*) AS total FROM contacts WHERE projectId = ? AND deletedAt IS NULL AND suppressed = 1',
    )
    .get(projectId);
  return z.object({ total: z.number().int() }).parse(row).total;
}

export function findContactById(
  projectId: string,
  id: string,
  includeDeleted = false,
): Contact | undefined {
  const row = getDatabase()
    .prepare(
      `SELECT ${contactColumns.join(', ')} FROM contacts
       WHERE projectId = ? AND id = ?${includeDeleted ? '' : ' AND deletedAt IS NULL'}`,
    )
    .get(projectId, id);
  return row === undefined ? undefined : fromRow(contactRowSchema.parse(row));
}

export function findActiveContactByDestination(
  projectId: string,
  id: string,
  email: string,
): Contact | undefined {
  const row = getDatabase()
    .prepare(
      `SELECT ${contactColumns.join(', ')} FROM contacts
       WHERE projectId = ? AND id = ? AND email = ? AND deletedAt IS NULL AND suppressed = 0`,
    )
    .get(projectId, id, email);
  return row === undefined ? undefined : fromRow(contactRowSchema.parse(row));
}

export function findContactByEmail(
  projectId: string,
  email: string,
): Contact | undefined {
  const row = getDatabase()
    .prepare(
      `SELECT ${contactColumns.join(', ')} FROM contacts WHERE projectId = ? AND email = ?`,
    )
    .get(projectId, email);
  return row === undefined ? undefined : fromRow(contactRowSchema.parse(row));
}

export function findContactsByIds(
  projectId: string,
  ids: string[],
): Contact[] {
  if (!ids.length) return [];
  const rows = getDatabase()
    .prepare(
      `SELECT ${contactColumns.join(', ')} FROM contacts
       WHERE projectId = ? AND id IN (SELECT value FROM json_each(?))`,
    )
    .all(projectId, JSON.stringify(ids));
  return rows.map((row) => fromRow(contactRowSchema.parse(row)));
}

export function findExistingEmails(projectId: string, emails: string[]): Set<string> {
  if (!emails.length) return new Set();
  const rows = getDatabase()
    .prepare(
      `SELECT email FROM contacts
       WHERE projectId = ? AND email IN (SELECT value FROM json_each(?))`,
    )
    .all(projectId, JSON.stringify(emails));
  return new Set(
    rows.map((row) => z.object({ email: z.string() }).parse(row).email),
  );
}

export function createContact(projectId: string, input: ContactInput): Contact {
  const id = newId();
  const now = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO contacts
        (id, projectId, email, firstName, lastName, company, phone, website, city, state,
         country, source, notes, customFields, suppressed, deletedAt, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    )
    .run(
      id,
      projectId,
      input.email,
      input.firstName,
      input.lastName,
      input.company,
      input.phone,
      input.website,
      input.city,
      input.state,
      input.country,
      input.source,
      input.notes,
      JSON.stringify(input.customFields),
      fromBoolean(input.suppressed),
      now,
      now,
    );
  const contact = findContactById(projectId, id, true);
  if (!contact) throw new Error('Contact creation failed.');
  return contact;
}

export function insertContactIfMissing(
  projectId: string,
  email: string,
): Contact {
  const id = newId();
  const now = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO contacts
        (id, projectId, email, customFields, suppressed, createdAt, updatedAt)
       VALUES (?, ?, ?, '{}', 0, ?, ?)
       ON CONFLICT(projectId, email) DO NOTHING`,
    )
    .run(id, projectId, email, now, now);
  const contact = findContactByEmail(projectId, email);
  if (!contact) throw new Error('Contact creation failed.');
  return contact;
}

export function updateContact(
  projectId: string,
  id: string,
  input: ContactInput,
): Contact | undefined {
  const result = getDatabase()
    .prepare(
      `UPDATE contacts SET
        email = ?, firstName = ?, lastName = ?, company = ?, phone = ?, website = ?,
        city = ?, state = ?, country = ?, source = ?, notes = ?, customFields = ?,
        suppressed = ?, updatedAt = ?
       WHERE projectId = ? AND id = ? AND deletedAt IS NULL`,
    )
    .run(
      input.email,
      input.firstName,
      input.lastName,
      input.company,
      input.phone,
      input.website,
      input.city,
      input.state,
      input.country,
      input.source,
      input.notes,
      JSON.stringify(input.customFields),
      fromBoolean(input.suppressed),
      nowIso(),
      projectId,
      id,
    );
  return result.changes === 0 ? undefined : findContactById(projectId, id);
}

export function softDeleteContact(projectId: string, id: string): boolean {
  const result = getDatabase()
    .prepare(
      'UPDATE contacts SET deletedAt = ?, updatedAt = ? WHERE projectId = ? AND id = ? AND deletedAt IS NULL',
    )
    .run(nowIso(), nowIso(), projectId, id);
  return result.changes > 0;
}

export function suppressContact(projectId: string, id: string): boolean {
  const result = getDatabase()
    .prepare(
      'UPDATE contacts SET suppressed = 1, updatedAt = ? WHERE projectId = ? AND id = ?',
    )
    .run(nowIso(), projectId, id);
  return result.changes > 0;
}

export function audienceContacts(
  projectId: string,
  audience: ContactAudience,
): Contact[] {
  if (audience.mode === 'selected') {
    if (!audience.contactIds.length) return [];
    const rows = getDatabase()
      .prepare(
        `SELECT ${contactColumns.join(', ')} FROM contacts
         WHERE projectId = ? AND deletedAt IS NULL
           AND id IN (SELECT value FROM json_each(?))`,
      )
      .all(projectId, JSON.stringify(audience.contactIds));
    return rows.map((row) => fromRow(contactRowSchema.parse(row)));
  }
  if (audience.mode === 'all') {
    const rows = getDatabase()
      .prepare(
        `SELECT ${contactColumns.join(', ')} FROM contacts
         WHERE projectId = ? AND deletedAt IS NULL`,
      )
      .all(projectId);
    return rows.map((row) => fromRow(contactRowSchema.parse(row)));
  }
  const filter = filterClause(projectId, audience.filters);
  const rows = getDatabase()
    .prepare(
      `SELECT ${contactColumns.join(', ')} FROM contacts WHERE ${filter.sql}`,
    )
    .all(...filter.params);
  return rows.map((row) => fromRow(contactRowSchema.parse(row)));
}

export function emptyContact(projectId: string, email: string): Contact {
  const now = new Date();
  return {
    id: newId(),
    projectId,
    email,
    firstName: '',
    lastName: '',
    company: '',
    phone: '',
    website: '',
    city: '',
    state: '',
    country: '',
    source: '',
    notes: '',
    customFields: {},
    suppressed: false,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}
