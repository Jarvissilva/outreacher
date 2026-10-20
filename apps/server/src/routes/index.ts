import { Router } from 'express';
import { getHealth } from '../controllers/healthController.js';
import { requireDatabase } from '../middleware/requireDatabase.js';
import { projectRouter, projectsRouter } from './projectRoutes.js';

export const apiRouter = Router();
apiRouter.get('/health', getHealth);
apiRouter.use(requireDatabase);
apiRouter.use('/projects', projectsRouter);
apiRouter.use('/projects/:projectId', projectRouter);
