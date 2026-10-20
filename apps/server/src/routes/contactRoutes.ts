import { Router } from 'express';
import {
  listContacts,
  createContact,
  updateContact,
  deleteContact,
} from '../controllers/contactController.js';

export const contactsRouter = Router({ mergeParams: true });
contactsRouter.get('/', listContacts);
contactsRouter.post('/', createContact);
contactsRouter.put('/:id', updateContact);
contactsRouter.delete('/:id', deleteContact);
