import type { RequestHandler } from 'express';
import { findProject } from '../db/repositories/projects.js';
import { HttpError } from '../lib/HttpError.js';
import { getProjectId } from '../lib/getProjectId.js';

export const requireProject: RequestHandler = async (
  request,
  _response,
  next,
) => {
  if (!findProject(getProjectId(request)))
    throw new HttpError(404, 'Project not found.');
  next();
};
