import { Router } from 'express';
import {
  getImportHeaders,
  previewImport,
  importContacts,
} from '../controllers/importController.js';

export const importsRouter = Router({ mergeParams: true });
importsRouter.post('/headers', getImportHeaders);
importsRouter.post('/preview', previewImport);
importsRouter.post('/', importContacts);
