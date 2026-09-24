import type { OfflineReason, ServiceId } from '@crewstation/contracts';
import { ResourceIdSchema } from '@crewstation/contracts';
import type { NotDeployedEntry } from '../api/moduleApi';
import type { ServiceDirectory } from '../ports/directories';
import type { LedgerReader, LedgerRecordRead } from '../ports/ledger';

const OFFLINE_REASONS: readonly string[] = ['manual', 'rollback-expired', 'idle', 'cluster'] satisfies readonly OfflineReason[];

/**
 * 说明页的内容（D13）：照目标槽记录的领域条件 Serving 写——为假且原因是 `offline-<原因>` 的，何时因何下线、下线的是哪个版本；
 * 为假而没有下线原因的是尚未部署（正式主机即尚未上线）；已经为真是刚部署好、路由还没改回来（recovering）。
 */
export function notDeployedEntry(role: 'prod' | 'preview', projectSlug: string, slot: Pick<LedgerRecordRead, 'conditions' | 'display'> | undefined): NotDeployedEntry {
  const serving = slot?.conditions.find((condition) => condition.type === 'Serving');
  if (serving?.status === 'true') return { kind: 'not-deployed', projectSlug, slot: role, recovering: true };
  const reason = serving?.reason?.startsWith('offline-') ? serving.reason.slice('offline-'.length) : undefined;
  const tag = slot?.display['tag'];
  const offline = reason && OFFLINE_REASONS.includes(reason) ? { at: serving!.since, reason: reason as OfflineReason, ...(tag ? { tag } : {}) } : undefined;
  return { kind: 'not-deployed', projectSlug, slot: role, ...(offline ? { offline } : {}) };
}

/** 接口请求得到的 503 错误体：沿用 RFC-021 的 `not-deployed`＋`details`（details 是下线的时间、原因与版本；I26 裁定）。 */
export function notDeployedBody(entry: NotDeployedEntry): { readonly error: 'not-deployed'; readonly message: string; readonly details: Record<string, unknown> } {
  const message = entry.recovering ? `${entry.projectSlug} 刚部署好新版本，正在切换，请稍后重试` : entry.slot === 'prod' ? `${entry.projectSlug} 还没有上线的版本` : `${entry.projectSlug} 当前没有待验证版本`;
  return { error: 'not-deployed', message, details: entry.offline ? { ...entry.offline } : {} };
}

const hostOf = (value: string | undefined): string => (value ?? '').split(',')[0]!.trim().toLowerCase().replace(/:\d+$/, '');

/**
 * 说明页的用例（RFC-025 设计 §7.2）：按路由记录 ID 找到 gateway 写的待验证或正式路由，核对请求确实是冲着这条路由的主机来的
 * （别的主机拿着 ID 来问一律当不存在），再读它目标 Service 所属的槽记录。不是这样的路由返回 undefined（404）。
 */
export function explainUnavailable(deps: { readonly ledgerReader: LedgerReader; readonly services: ServiceDirectory }) {
  return async (routeId: string, host: string | undefined): Promise<NotDeployedEntry | undefined> => {
    if (!ResourceIdSchema.safeParse(routeId).success) return undefined;
    const route = await deps.ledgerReader.get(routeId);
    const role = route?.display['role'], target = route?.spec['target'] as { namespace?: unknown; service?: unknown } | undefined;
    if (!route || route.kind !== 'route' || route.owner.module !== 'gateway' || (role !== 'prod' && role !== 'preview')) return undefined;
    if (typeof route.spec['host'] !== 'string' || route.spec['host'].toLowerCase() !== hostOf(host)) return undefined;
    const service = await deps.services.getService(route.owner.ref.split('/')[0] as ServiceId);
    if (!service || typeof target?.namespace !== 'string' || typeof target.service !== 'string') return undefined;
    const slotId = await deps.ledgerReader.claimOf({ kind: 'Service', namespace: target.namespace, name: target.service });
    const slot = slotId ? await deps.ledgerReader.get(slotId) : undefined;
    return notDeployedEntry(role, service.projectSlug, slot?.kind === 'service-slot' ? slot : undefined);
  };
}
