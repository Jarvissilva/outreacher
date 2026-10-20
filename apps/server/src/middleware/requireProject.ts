import type { RequestHandler } from 'express';
import { ProjectModel } from '../models/index.js';
import { HttpError } from '../lib/HttpError.js';
import { getProjectId } from '../lib/getProjectId.js';

export const requireProject: RequestHandler = async (
  request,
  _response,
  next,
) => {
  const projectId = getProjectId(request);
  if (!(await ProjectModel.exists({ _id: projectId })))
    throw new HttpError(404, 'Project not found.');
  next();
};
