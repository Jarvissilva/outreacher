import { parse } from 'csv-parse/sync';
import { contactInputSchema, csvColumns } from '@outreachit/shared';
import type { ImportRequest } from '@outreachit/shared';
import { ContactModel, FieldModel } from '../models/index.js';
import { HttpError } from '../lib/HttpError.js';

export function parseCsv(csv: string): {
  headers: string[];
  records: string[][];
} {
  let records: string[][];
  try {
    records = parse(csv, {
      bom: true,
      skip_empty_lines: true,
      trim: true,
      max_record_size: 50_000,
    });
  } catch {
    throw new HttpError(
      400,
      'Could not parse this CSV. Check quotes and ensure each row has the same number of columns.',
    );
  }
  const headers = records.shift();
  if (
    !headers?.length ||
    headers.some((header) => !header) ||
    new Set(headers).size !== headers.length
  ) {
    throw new HttpError(
      400,
      'CSV headers must be present, non-empty, and unique.',
    );
  }
  if (!records.length) throw new HttpError(400, 'The CSV has no contact rows.');
  if (records.length > 2000 || headers.length > 100)
    throw new HttpError(
      400,
      'Import at most 2,000 contacts and 100 columns at a time.',
    );
  return { headers, records };
}

export async function prepareImport(input: ImportRequest, projectId: string) {
  const { headers, records } = parseCsv(input.csv);
  const fields = await FieldModel.find({ projectId });
  const validKeys = new Set<string>([
    ...csvColumns,
    ...fields.map((field) => `custom.${field.key}`),
  ]);
  if (!input.mapping.email)
    throw new HttpError(400, 'Map an email column before continuing.');
  for (const [key, header] of Object.entries(input.mapping)) {
    if (!validKeys.has(key) || !headers.includes(header))
      throw new HttpError(400, `Invalid column mapping: ${key}.`);
  }
  const mapping = Object.entries(input.mapping).map(([key, header]) => ({
    key,
    index: headers.indexOf(header),
  }));
  const candidates = records.map((record, index) => {
    const values: Record<string, unknown> = {};
    const customFields: Record<string, string> = {};
    for (const { key, index: columnIndex } of mapping) {
      const value = record[columnIndex] ?? '';
      if (key.startsWith('custom.')) customFields[key.slice(7)] = value;
      else values[key] = value;
    }
    values.customFields = customFields;
    const parsed = contactInputSchema.safeParse(values);
    return { row: index + 2, email: String(values.email ?? ''), parsed };
  });
  const existing = await ContactModel.find({
    projectId,
    email: {
      $in: candidates.flatMap((row) =>
        row.parsed.success ? [row.parsed.data.email] : [],
      ),
    },
  }).select('email');
  const seen = new Set(existing.map((contact) => contact.email));
  return candidates.map((candidate) => {
    if (!candidate.parsed.success) {
      return {
        row: candidate.row,
        email: candidate.email,
        status: 'invalid' as const,
        issues: candidate.parsed.error.issues.map(
          (issue) => `${issue.path.join('.')}: ${issue.message}`,
        ),
        contact: null,
      };
    }
    const contact = candidate.parsed.data;
    if (seen.has(contact.email))
      return {
        row: candidate.row,
        email: contact.email,
        status: 'duplicate' as const,
        issues: ['Email already exists or repeats in this file.'],
        contact: null,
      };
    seen.add(contact.email);
    return {
      row: candidate.row,
      email: contact.email,
      status: 'ready' as const,
      issues: [],
      contact,
    };
  });
}
