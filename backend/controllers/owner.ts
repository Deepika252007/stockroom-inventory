import type { DatabaseSync } from 'node:sqlite';
import { readEmployees, readOwnerDashboard } from '../database/sqlite';
import type { OwnerDashboard } from '../models/owner';

export function getOwnerDashboard(database: DatabaseSync, timezone: string): OwnerDashboard {
  return readOwnerDashboard(database, timezone);
}

export function getOwnerEmployees(database: DatabaseSync) {
  return readEmployees(database);
}
