import type { RequestHandler } from 'express';
import { idSchema, projectInputSchema } from '@outreacher/shared';
import {
  countContacts,
  countSuppressedContacts,
} from '../db/repositories/contacts.js';
import {
  createProject as createProjectRecord,
  listProjects as listProjectRecords,
  serializeProject,
  updateProject as updateProjectRecord,
} from '../db/repositories/projects.js';
import { HttpError } from '../lib/HttpError.js';
import { getProjectId } from '../lib/getProjectId.js';

export const listProjects: RequestHandler = async (_request, response) => {
  response.json(
    listProjectRecords().map((project) =>
      serializeProject(project, countContacts(project.id)),
    ),
  );
};

export const createProject: RequestHandler = async (request, response) => {
  const project = createProjectRecord(
    projectInputSchema.parse(request.body),
  );
  response.status(201).json(serializeProject(project, 0));
};

export const updateProject: RequestHandler = async (request, response) => {
  const project = updateProjectRecord(
    idSchema.parse(request.params.id),
    projectInputSchema.parse(request.body),
  );
  if (!project) throw new HttpError(404, 'Project not found.');
  response.json(serializeProject(project, countContacts(project.id)));
};

export const getOverview: RequestHandler = async (request, response) => {
  const projectId = getProjectId(request);
  const contacts = countContacts(projectId);
  const suppressed = countSuppressedContacts(projectId);
  response.json({
    projectId,
    contacts,
    active: contacts - suppressed,
    suppressed,
  });
};
