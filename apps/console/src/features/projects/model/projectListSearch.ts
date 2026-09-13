import { ProjectStateSchema, UserIdSchema } from '@crewstation/contracts';

export interface ProjectListSearch { q?: string; state?: 'provisioning' | 'active' | 'paused' | 'archived' | 'failed'; ownerUserId?: string; cursor?: string }
export function parseProjectListSearch(raw: Record<string, unknown>): ProjectListSearch {
  return { q: typeof raw.q === 'string' ? raw.q.trim().slice(0, 120) : '',
    state: ProjectStateSchema.safeParse(raw.state).data, ownerUserId: UserIdSchema.safeParse(raw.ownerUserId).data,
    cursor: typeof raw.cursor === 'string' && raw.cursor.length > 0 && raw.cursor.length <= 2048 ? raw.cursor : undefined };
}
