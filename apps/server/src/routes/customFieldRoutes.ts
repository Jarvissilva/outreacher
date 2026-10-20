import { Router } from 'express';
import {
  listFields,
  createField,
  updateField,
  deleteField,
} from '../controllers/customFieldController.js';

export const fieldsRouter = Router({ mergeParams: true });
fieldsRouter.get('/', listFields);
fieldsRouter.post('/', createField);
fieldsRouter.put('/:id', updateField);
fieldsRouter.delete('/:id', deleteField);
