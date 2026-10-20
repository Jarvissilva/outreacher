import { emailRouter } from './emailRoutes.js';
import { Router } from 'express';
import {
  listProjects,
  createProject,
  updateProject,
  getOverview,
} from '../controllers/projectController.js';
import { requireProject } from '../middleware/requireProject.js';
import { contactsRouter } from './contactRoutes.js';
import { fieldsRouter } from './customFieldRoutes.js';
import { importsRouter } from './importRoutes.js';

export const projectsRouter = Router();
projectsRouter.get('/', listProjects);
projectsRouter.post('/', createProject);
projectsRouter.put('/:id', updateProject);

export const projectRouter = Router({ mergeParams: true });
projectRouter.use(requireProject);
projectRouter.get('/overview', getOverview);
projectRouter.use('/contacts/import', importsRouter);
projectRouter.use('/contacts', contactsRouter);
projectRouter.use('/custom-fields', fieldsRouter);

projectRouter.use(emailRouter);
