import type { RequestHandler } from 'express';
import {
  contactInputSchema,
  contactQuerySchema,
  idSchema,
} from '@outreacher/shared';
import {
  createContact as createContactRecord,
  findContactById,
  listContacts as listContactRecords,
  serializeContact,
  softDeleteContact,
  updateContact as updateContactRecord,
} from '../db/repositories/contacts.js';
import { findFieldByKey } from '../db/repositories/customFields.js';
import { HttpError } from '../lib/HttpError.js';
import { getProjectId } from '../lib/getProjectId.js';
import { validateContactReferences } from '../services/contactService.js';

export const listContacts: RequestHandler = async (request, response) => {
  const projectId = getProjectId(request);
  const query = contactQuerySchema.parse(request.query);
  if (query.fieldKey && !findFieldByKey(projectId, query.fieldKey)) {
    throw new HttpError(404, 'Custom field not found.');
  }
  if (query.fieldValue && !query.fieldKey)
    throw new HttpError(400, 'Choose a custom field to filter.');
  const { items, total } = listContactRecords(projectId, query);
  response.json({
    projectId,
    items: items.map(serializeContact),
    total,
    page: query.page,
    limit: query.limit,
  });
};

export const createContact: RequestHandler = async (request, response) => {
  const input = contactInputSchema.parse(request.body);
  const projectId = getProjectId(request);
  await validateContactReferences(input, projectId);
  response
    .status(201)
    .json(serializeContact(createContactRecord(projectId, input)));
};

export const updateContact: RequestHandler = async (request, response) => {
  const id = idSchema.parse(request.params.id);
  const input = contactInputSchema.parse(request.body);
  const projectId = getProjectId(request);
  if (!findContactById(projectId, id))
    throw new HttpError(404, 'Contact not found.');
  await validateContactReferences(input, projectId);
  const contact = updateContactRecord(projectId, id, input);
  if (!contact) throw new HttpError(404, 'Contact not found.');
  response.json(serializeContact(contact));
};

export const deleteContact: RequestHandler = async (request, response) => {
  if (!softDeleteContact(getProjectId(request), idSchema.parse(request.params.id)))
    throw new HttpError(404, 'Contact not found.');
  response.status(204).end();
};
