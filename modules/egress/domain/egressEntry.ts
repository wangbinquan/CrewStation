import type { EgressScope, ProjectId, UserId } from '@crewstation/contracts';
import { validation } from '@crewstation/kernel';
import { normalizeHost } from './fqdnMatch';

/** 出站白名单条目（G23）：全局条目对所有项目生效，项目级条目只对一个项目生效；两者合并即该项目的放行清单。 */
export interface EgressEntry {
  readonly id: string;
  readonly fqdn: string;
  readonly scope: EgressScope;
  readonly projectId?: ProjectId;
  readonly note?: string;
  readonly createdBy: UserId;
  readonly createdAt: Date;
}

/** 与 contracts 的 EgressFqdnPatternSchema 同形：精确 FQDN 或 `*.` 通配。 */
export const FQDN_PATTERN = /^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/;

export function assertFqdnPattern(fqdn: string): string {
  const normalized = normalizeHost(fqdn);
  if (!FQDN_PATTERN.test(normalized)) throw validation(`FQDN ${fqdn} 形如 api.example.com 或 *.example.com`, { fqdn });
  return normalized;
}

export interface NewEgressEntry {
  readonly id: string;
  readonly fqdn: string;
  readonly scope: EgressScope;
  readonly projectId?: ProjectId;
  readonly note?: string;
  readonly createdBy: UserId;
  readonly createdAt: Date;
}

/** 作用域与 projectId 必须一致：项目级必带、全局不得带。 */
export function newEgressEntry(input: NewEgressEntry): EgressEntry {
  const fqdn = assertFqdnPattern(input.fqdn);
  if (input.scope === 'project' && !input.projectId) throw validation('项目级条目必须指定 projectId');
  if (input.scope === 'global' && input.projectId) throw validation('全局条目不能指定 projectId');
  return {
    id: input.id, fqdn, scope: input.scope, createdBy: input.createdBy, createdAt: input.createdAt,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.note ? { note: input.note } : {}),
  };
}

/** 某项目的有效放行清单：全局与项目级去重、排序，便于比较版本与下发。 */
export function mergePolicy(entries: readonly EgressEntry[]): string[] {
  return [...new Set(entries.map((e) => e.fqdn))].sort();
}
