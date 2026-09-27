import type { Executor } from '@crewstation/persistence';
import { eq } from 'drizzle-orm';
import { text } from 'drizzle-orm/pg-core';
import type { AppIconImages } from '../../ports/appIcons';
import { projectSchema } from './schema';

const appIcons = projectSchema.table('app_icons', { projectId: text('project_id').primaryKey(), content: text('content').notNull(), mime: text('mime').notNull() });
export function drizzleAppIcons(db: Executor): AppIconImages {
  return {
    get: async (projectId) => { const row = (await db.select().from(appIcons).where(eq(appIcons.projectId, projectId)))[0]; return row ? { content: row.content, mime: 'image/webp' } : undefined; },
    put: async (projectId, image) => { await db.insert(appIcons).values({ projectId, ...image }).onConflictDoUpdate({ target: appIcons.projectId, set: image }); },
    remove: async (projectId) => { await db.delete(appIcons).where(eq(appIcons.projectId, projectId)); },
  };
}
