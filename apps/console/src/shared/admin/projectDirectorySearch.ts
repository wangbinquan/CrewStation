import { ManifestKindSchema, ProjectStateSchema, UserIdSchema } from '@crewstation/contracts';
import type { ManifestKind, ProjectState } from '@crewstation/contracts';
import { isIntegrationKind } from './integrationKinds';

export interface ProjectDirectorySearch { q?: string; kind?: ManifestKind; state?: ProjectState; ownerUserId?: string; cursor?: string }
/** 类型只在接入容器目录里筛（两种接入 kind）；项目管理只列数字人，旧链接带的 kind 一律忽略（2026-09-24 裁定）。 */
export function parseProjectDirectorySearch(raw: Record<string, unknown>, integration = false): ProjectDirectorySearch {
  const kind = ManifestKindSchema.safeParse(raw.kind).data;
  return { q: typeof raw.q === 'string' ? raw.q.trim().slice(0, 120) : '',
    kind: integration && isIntegrationKind(kind) ? kind : undefined, state: ProjectStateSchema.safeParse(raw.state).data,
    ownerUserId: UserIdSchema.safeParse(raw.ownerUserId).data,
    cursor: typeof raw.cursor === 'string' && raw.cursor.length > 0 && raw.cursor.length <= 2048 ? raw.cursor : undefined };
}
