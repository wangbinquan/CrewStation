import { ProjectStateSchema, UserIdSchema } from '@crewstation/contracts';
import type { ProjectState } from '@crewstation/contracts';

export interface ProjectListSearch { q?: string; state?: ProjectState; ownerUserId?: string; ownerName?: string; cursor?: string; create?: boolean }
export function parseProjectListSearch(raw: Record<string, unknown>): ProjectListSearch {
  return { ...(raw.create === true || raw.create === 'true' ? { create: true } : {}), ownerName: typeof raw.ownerName === 'string' ? raw.ownerName.slice(0, 120) : undefined, q: typeof raw.q === 'string' ? raw.q.trim().slice(0, 120) : '',
    state: ProjectStateSchema.safeParse(raw.state).data, ownerUserId: UserIdSchema.safeParse(raw.ownerUserId).data,
    cursor: typeof raw.cursor === 'string' && raw.cursor.length > 0 && raw.cursor.length <= 2048 ? raw.cursor : undefined };
}
