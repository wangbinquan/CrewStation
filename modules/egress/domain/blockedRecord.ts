import type { EgressSource, ProjectId } from '@crewstation/contracts';
import { normalizeHost } from './fqdnMatch';

/** 被出站代理阻断的目标：按 (project, fqdn) 计数，工作台据此提示申请追加。 */
export interface BlockedRecord {
  readonly projectId: ProjectId;
  readonly fqdn: string;
  readonly count: number;
  readonly lastSeenAt: Date;
  readonly source?: EgressSource;
}

export function recordHit(existing: BlockedRecord | undefined, projectId: ProjectId, fqdn: string, source: EgressSource | undefined, now: Date): BlockedRecord {
  const host = normalizeHost(fqdn);
  const latestSource = source ?? existing?.source;
  return { projectId, fqdn: host, count: (existing?.count ?? 0) + 1, lastSeenAt: now, ...(latestSource ? { source: latestSource } : {}) };
}
