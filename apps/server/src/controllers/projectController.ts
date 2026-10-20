import type { RequestHandler } from 'express';
import { idSchema, projectInputSchema } from '@outreachit/shared';
import { ContactModel, ProjectModel } from '../models/index.js';
import { HttpError } from '../lib/HttpError.js';
import { getProjectId } from '../lib/getProjectId.js';

export const listProjects: RequestHandler = async (_request, response) => {
  const projects = await ProjectModel.find().sort({ createdAt: 1, _id: 1 });
  response.json(
    await Promise.all(
      projects.map(async (project) => ({
        id: String(project._id),
        name: project.name,
        isDefault: project.isDefault,
        contactCount: await ContactModel.countDocuments({
          projectId: project._id,
          deletedAt: null,
        }),
      })),
    ),
  );
};

export const createProject: RequestHandler = async (request, response) => {
  const input = projectInputSchema.parse(request.body);
  const project = await ProjectModel.create({
    ...input,
    normalizedName: input.name.toLowerCase(),
  });
  response.status(201).json({
    id: String(project._id),
    name: project.name,
    isDefault: project.isDefault,
    contactCount: 0,
  });
};

export const updateProject: RequestHandler = async (request, response) => {
  const input = projectInputSchema.parse(request.body);
  const project = await ProjectModel.findByIdAndUpdate(
    idSchema.parse(request.params.id),
    { ...input, normalizedName: input.name.toLowerCase() },
    { returnDocument: 'after', runValidators: true },
  );
  if (!project) throw new HttpError(404, 'Project not found.');
  response.json({
    id: String(project._id),
    name: project.name,
    isDefault: project.isDefault,
    contactCount: await ContactModel.countDocuments({
      projectId: project._id,
      deletedAt: null,
    }),
  });
};

export const getOverview: RequestHandler = async (request, response) => {
  const projectId = getProjectId(request);
  const [contacts, suppressed] = await Promise.all([
    ContactModel.countDocuments({ projectId, deletedAt: null }),
    ContactModel.countDocuments({
      projectId,
      deletedAt: null,
      suppressed: true,
    }),
  ]);
  response.json({
    projectId,
    contacts,
    active: contacts - suppressed,
    suppressed,
  });
};
