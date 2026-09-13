import { ManifestKindSchema, ProjectStateSchema, UserIdSchema } from '@crewstation/contracts';
import type { ManifestKind, ProjectState } from '@crewstation/contracts';

export interface ProjectDirectorySearch { q?: string; kind?: ManifestKind; state?: ProjectState; ownerUserId?: string; cursor?: string }
export function parseProjectDirectorySearch(raw: Record<string, unknown>, integration = false): ProjectDirectorySearch {
  const kind = ManifestKindSchema.safeParse(raw.kind).data;
  return { q: typeof raw.q === 'string' ? raw.q.trim().slice(0, 120) : '',
    kind: integration && kind === 'DigitalWorker' ? undefined : kind, state: ProjectStateSchema.safeParse(raw.state).data,
    ownerUserId: UserIdSchema.safeParse(raw.ownerUserId).data,
    cursor: typeof raw.cursor === 'string' && raw.cursor.length > 0 && raw.cursor.length <= 2048 ? raw.cursor : undefined };
}
