import { getDatabase, transaction } from './database.js';
import {
  findDefaultProject,
  insertDefaultProject,
  markProjectDefault,
} from './repositories/projects.js';
import type { Project } from './repositories/projects.js';

// Run before accepting requests or starting workers.
export function ensureDefaultProject(): Project {
  return transaction(() => {
    const current = findDefaultProject();
    if (current) return current;
    const existing = getDatabase()
      .prepare('SELECT id FROM projects WHERE normalizedName = ?')
      .get('default project');
    if (existing && typeof existing === 'object' && 'id' in existing) {
      const id = String(existing.id);
      markProjectDefault(id);
      const project = findDefaultProject();
      if (project) return project;
    }
    return insertDefaultProject();
  });
}

export const bootstrapDatabase = ensureDefaultProject;
