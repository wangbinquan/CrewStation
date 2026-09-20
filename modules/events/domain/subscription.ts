import type { ProjectId, ServiceId } from '@crewstation/contracts';

export type SubscriptionState = 'active' | 'paused';

/** 数字人对某事件类型的订阅：Manifest `subscriptions` 段声明，推送到 active prod 槽的 handlerPath。 */
export interface Subscription {
  readonly id: string;
  readonly serviceId: ServiceId;
  readonly projectId: ProjectId;
  readonly eventTypeId: string;
  readonly eventType: string;
  readonly handlerPath: string;
  readonly state: SubscriptionState;
  readonly updatedAt: Date;
}

export interface DeclaredSubscription {
  readonly eventTypeId: string;
  readonly eventType: string;
  readonly handlerPath: string;
}

export interface SubscriptionChanges {
  readonly upserts: Subscription[];
  readonly removedIds: string[];
}

/**
 * 用新发布的声明替换服务的订阅：同一事件类型保留原 id（待投递的记录继续有效，改路径立即生效），
 * 新增的事件类型建新订阅，不再声明的移除。一个服务对一个事件类型只有一条订阅，重复声明以第一条为准。
 */
export function reconcileSubscriptions(
  existing: readonly Subscription[], declared: readonly DeclaredSubscription[],
  owner: { serviceId: ServiceId; projectId: ProjectId }, mintId: () => string, now: Date,
): SubscriptionChanges {
  const byType = new Map(existing.map((s) => [s.eventTypeId, s] as const));
  const seen = new Set<string>();
  const upserts: Subscription[] = [];
  for (const d of declared) {
    if (seen.has(d.eventTypeId)) continue;
    seen.add(d.eventTypeId);
    const previous = byType.get(d.eventTypeId);
    upserts.push(previous
      ? { ...previous, eventType: d.eventType, handlerPath: d.handlerPath, updatedAt: now }
      : { id: mintId(), serviceId: owner.serviceId, projectId: owner.projectId, eventTypeId: d.eventTypeId, eventType: d.eventType, handlerPath: d.handlerPath, state: 'active', updatedAt: now });
  }
  return { upserts, removedIds: existing.filter((s) => !seen.has(s.eventTypeId)).map((s) => s.id) };
}
