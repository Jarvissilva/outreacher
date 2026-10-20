import type { RequestHandler } from 'express';
import { fieldInputSchema, idSchema } from '@outreachit/shared';
import { ContactModel, FieldModel } from '../models/index.js';
import { HttpError } from '../lib/HttpError.js';
import { getProjectId } from '../lib/getProjectId.js';

export const listFields: RequestHandler = async (request, response) => {
  response.json(
    (
      await FieldModel.find({ projectId: getProjectId(request) }).sort({
        createdAt: 1,
      })
    ).map((field) => ({
      id: String(field._id),
      projectId: String(field.projectId),
      key: field.key,
      label: field.label,
    })),
  );
};

export const createField: RequestHandler = async (request, response) => {
  const field = await FieldModel.create({
    ...fieldInputSchema.parse(request.body),
    projectId: getProjectId(request),
  });
  response.status(201).json({
    id: String(field._id),
    projectId: String(field.projectId),
    key: field.key,
    label: field.label,
  });
};

export const updateField: RequestHandler = async (request, response) => {
  const input = fieldInputSchema.parse(request.body);
  const field = await FieldModel.findOne({
    _id: idSchema.parse(request.params.id),
    projectId: getProjectId(request),
  });
  if (!field) throw new HttpError(404, 'Custom field not found.');
  if (field.key !== input.key)
    throw new HttpError(400, 'A custom field key cannot be changed.');
  field.label = input.label;
  await field.save();
  response.json({
    id: String(field._id),
    projectId: String(field.projectId),
    key: field.key,
    label: field.label,
  });
};

export const deleteField: RequestHandler = async (request, response) => {
  const field = await FieldModel.findOne({
    _id: idSchema.parse(request.params.id),
    projectId: getProjectId(request),
  });
  if (!field) throw new HttpError(404, 'Custom field not found.');
  if (
    await ContactModel.exists({
      projectId: field.projectId,
      deletedAt: null,
      [`customFields.${field.key}`]: { $exists: true, $nin: ['', null] },
    })
  ) {
    throw new HttpError(
      409,
      'Clear this field from existing contacts before deleting it.',
    );
  }
  await ContactModel.updateMany(
    { projectId: field.projectId },
    { $unset: { [`customFields.${field.key}`]: '' } },
  );
  await field.deleteOne();
  response.status(204).end();
};
