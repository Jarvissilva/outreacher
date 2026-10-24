import { z } from 'zod';
import { idSchema } from '@outreacher/shared';

const paramsSchema = z.object({ projectId: idSchema });
export function getProjectId(request: { params: unknown }) {
  return paramsSchema.parse(request.params).projectId;
}
