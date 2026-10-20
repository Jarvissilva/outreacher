import type { ContactInput } from '@outreachit/shared';
import { FieldModel } from '../models/index.js';
import { HttpError } from '../lib/HttpError.js';

export async function validateContactReferences(
  input: ContactInput,
  projectId: string,
) {
  const keys = Object.keys(input.customFields);
  if (
    (await FieldModel.countDocuments({ projectId, key: { $in: keys } })) !==
    keys.length
  ) {
    throw new HttpError(400, 'One or more custom fields no longer exist.');
  }
}
