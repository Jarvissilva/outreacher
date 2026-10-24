import type { ContactInput } from '@outreacher/shared';
import { countFieldsByKeys } from '../db/repositories/customFields.js';
import { HttpError } from '../lib/HttpError.js';

export async function validateContactReferences(
  input: ContactInput,
  projectId: string,
) {
  const keys = Object.keys(input.customFields);
  if (countFieldsByKeys(projectId, keys) !== keys.length) {
    throw new HttpError(400, 'One or more custom fields no longer exist.');
  }
}
