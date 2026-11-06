import { Router } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { getOwnerDashboard, getOwnerEmployees } from '../controllers/owner';
import type { Store } from '../models/store';

export function createOwnerRouter(database: DatabaseSync, getStore: () => Store) {
  const router = Router();
  router.get('/dashboard', (_request, response) => {
    response.json(getOwnerDashboard(database, getStore().store.timezone));
  });
  router.get('/employees', (_request, response) => {
    response.json({ employees: getOwnerEmployees(database) });
  });
  return router;
}
