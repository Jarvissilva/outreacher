import type { RequestHandler } from 'express';
import { importRequestSchema } from '@outreachit/shared';
import type { ContactInput } from '@outreachit/shared';
import { ContactModel } from '../models/index.js';
import { isDuplicate } from '../lib/HttpError.js';
import { getProjectId } from '../lib/getProjectId.js';
import { parseCsv, prepareImport } from '../services/importService.js';

export const getImportHeaders: RequestHandler = (request, response) => {
  const { csv } = importRequestSchema.pick({ csv: true }).parse(request.body);
  response.json({
    projectId: getProjectId(request),
    headers: parseCsv(csv).headers,
  });
};

export const previewImport: RequestHandler = async (request, response) => {
  const rows = await prepareImport(
    importRequestSchema.parse(request.body),
    getProjectId(request),
  );
  response.json({
    projectId: getProjectId(request),
    total: rows.length,
    ready: rows.filter((row) => row.status === 'ready').length,
    duplicates: rows.filter((row) => row.status === 'duplicate').length,
    invalid: rows.filter((row) => row.status === 'invalid').length,
    rows: rows.slice(0, 50).map(({ row, email, status, issues }) => ({
      row,
      email,
      status,
      issues,
    })),
  });
};

export const importContacts: RequestHandler = async (request, response) => {
  const rows = await prepareImport(
    importRequestSchema.parse(request.body),
    getProjectId(request),
  );
  const result = {
    projectId: getProjectId(request),
    imported: 0,
    duplicates: 0,
    invalid: 0,
  };
  // Recheck duplicates at write time: preview is advisory and unique indexes remain authoritative.
  const contacts: ContactInput[] = [];
  for (const row of rows) {
    if (row.status === 'invalid') result.invalid++;
    else if (row.status === 'duplicate') result.duplicates++;
    else if (row.contact) contacts.push(row.contact);
  }
  for (const contact of contacts) {
    try {
      await ContactModel.create({
        ...contact,
        projectId: getProjectId(request),
      });
      result.imported++;
    } catch (error) {
      if (!isDuplicate(error)) throw error;
      result.duplicates++;
    }
  }
  response.status(201).json(result);
};
