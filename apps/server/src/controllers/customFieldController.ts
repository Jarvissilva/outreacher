import type { RequestHandler } from 'express';
import { fieldInputSchema, idSchema } from '@outreacher/shared';
import {
  createField as createFieldRecord,
  deleteField as deleteFieldRecord,
  findField,
  listFields as listFieldRecords,
  serializeField,
  updateFieldLabel,
} from '../db/repositories/customFields.js';
import { HttpError } from '../lib/HttpError.js';
import { getProjectId } from '../lib/getProjectId.js';

export const listFields: RequestHandler = async (request, response) => {
  response.json(
    listFieldRecords(getProjectId(request)).map(serializeField),
  );
};

export const createField: RequestHandler = async (request, response) => {
  const field = createFieldRecord(
    getProjectId(request),
    fieldInputSchema.parse(request.body),
  );
  response.status(201).json(serializeField(field));
};

export const updateField: RequestHandler = async (request, response) => {
  const input = fieldInputSchema.parse(request.body);
  const projectId = getProjectId(request);
  const field = findField(projectId, idSchema.parse(request.params.id));
  if (!field) throw new HttpError(404, 'Custom field not found.');
  if (field.key !== input.key)
    throw new HttpError(400, 'A custom field key cannot be changed.');
  const updated = updateFieldLabel(projectId, field.id, input.label);
  if (!updated) throw new HttpError(404, 'Custom field not found.');
  response.json(serializeField(updated));
};

export const deleteField: RequestHandler = async (request, response) => {
  const result = deleteFieldRecord(
    getProjectId(request),
    idSchema.parse(request.params.id),
  );
  if (result === 'missing') throw new HttpError(404, 'Custom field not found.');
  if (result === 'referenced')
    throw new HttpError(
      409,
      'Clear this field from existing contacts before deleting it.',
    );
  response.status(204).end();
};
