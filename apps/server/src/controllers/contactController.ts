import type { RequestHandler } from 'express';
import {
  contactInputSchema,
  contactQuerySchema,
  idSchema,
} from '@outreachit/shared';
import { ContactModel, FieldModel, serializeContact } from '../models/index.js';
import { HttpError } from '../lib/HttpError.js';
import { getProjectId } from '../lib/getProjectId.js';

import { validateContactReferences } from '../services/contactService.js';

export const listContacts: RequestHandler = async (request, response) => {
  const projectId = getProjectId(request);
  const query = contactQuerySchema.parse(request.query);
  const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (
    query.fieldKey &&
    !(await FieldModel.exists({ projectId, key: query.fieldKey }))
  ) {
    throw new HttpError(404, 'Custom field not found.');
  }
  if (query.fieldValue && !query.fieldKey)
    throw new HttpError(400, 'Choose a custom field to filter.');
  const fieldValue = query.fieldValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const filter = {
    projectId,
    deletedAt: null,
    ...(query.status === 'all'
      ? {}
      : { suppressed: query.status === 'suppressed' }),
    ...(query.fieldKey
      ? {
          [`customFields.${query.fieldKey}`]: {
            $regex: fieldValue,
            $options: 'i',
          },
        }
      : {}),
    ...(escaped
      ? {
          $or: [
            'email',
            'firstName',
            'lastName',
            'company',
            'city',
            'source',
          ].map((key) => ({ [key]: { $regex: escaped, $options: 'i' } })),
        }
      : {}),
  };
  const [contacts, total] = await Promise.all([
    ContactModel.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit),
    ContactModel.countDocuments(filter),
  ]);
  response.json({
    projectId,
    items: contacts.map(serializeContact),
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
    .json(serializeContact(await ContactModel.create({ ...input, projectId })));
};

export const updateContact: RequestHandler = async (request, response) => {
  const id = idSchema.parse(request.params.id);
  const input = contactInputSchema.parse(request.body);
  const projectId = getProjectId(request);
  if (!(await ContactModel.exists({ _id: id, projectId, deletedAt: null })))
    throw new HttpError(404, 'Contact not found.');
  await validateContactReferences(input, projectId);
  const contact = await ContactModel.findOneAndUpdate(
    { _id: id, projectId, deletedAt: null },
    { $set: input },
    { returnDocument: 'after', runValidators: true },
  );
  if (!contact) throw new HttpError(404, 'Contact not found.');
  response.json(serializeContact(contact));
};

export const deleteContact: RequestHandler = async (request, response) => {
  const contact = await ContactModel.findOneAndUpdate(
    {
      _id: idSchema.parse(request.params.id),
      projectId: getProjectId(request),
      deletedAt: null,
    },
    { $set: { deletedAt: new Date() } },
  );
  if (!contact) throw new HttpError(404, 'Contact not found.');
  response.status(204).end();
};
