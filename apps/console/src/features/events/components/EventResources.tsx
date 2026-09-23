import type { EventTypeDto, SubscriptionDto } from '@crewstation/contracts';
import { useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Badge } from '../../../shared/ui/Badge';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { BreakableText, MetaLine, ResourceGroup, ResourceList, ResourceRow } from '../../../shared/ui/resource/ResourceList';
import { groupEventTypes, subscriptionSnippet } from './eventFamilies';
import type { EventFamily } from './eventFamilies';
import styles from './EventResources.module.css';

/**
 * 开发页「可使用资源 → 接收事件」：上面是本服务已订阅的（类型 → 处理路径），下面按生产方、事件族列出可订阅的类型；
 * 点一个类型复制可直接粘进 crewstation.yaml 的订阅片段（2026-09-23 作者裁定，与接口列表同一种两行样式）。
 */
export function EventResources({ projectId, subscription, extra }: { readonly projectId: string; readonly subscription?: string; readonly extra?: ReactNode }): ReactElement {
  const t = useT();
  const subscriptions = useApiQuery(queryKeys.subscriptions(projectId), () => api.events.listSubscriptions(projectId), { enabled: projectId !== '' });
  const eventTypes = useApiQuery(queryKeys.eventTypes(), () => api.events.listEventTypes());
  const subscribed = subscriptions.data?.items ?? [];
  const groups = useMemo(() => groupEventTypes(eventTypes.data?.items ?? []), [eventTypes.data]);
  const [copied, setCopied] = useState<{ type: string; ok: boolean }>();
  const copy = (type: EventTypeDto) => { void navigator.clipboard.writeText(subscriptionSnippet(type)).then(() => setCopied({ type: type.eventType, ok: true }), () => setCopied({ type: type.eventType, ok: false })); };
  const missing = subscription && !subscriptions.isPending && !subscriptions.error && !subscribed.some((item) => item.id === subscription);
  return <ResourceList label={t('events.list.label')}>
    <ResourceGroup title={t('events.list.subscribed')} count={subscriptions.isPending || subscriptions.error ? undefined : subscribed.length} note={t('events.list.subscribedNote')} empty={t('events.list.subscribedEmpty')}>
      {subscribed.map((item) => <SubscriptionRow key={item.id} subscription={item} current={item.id === subscription} />)}
    </ResourceGroup>
    <QueryStatus isPending={subscriptions.isPending} error={subscriptions.error} />
    {missing ? <p className={styles.note}>{t('events.subscriptions.missing')}</p> : null}
    <p className={styles.status} role="status" aria-live="polite">{copied ? t(copied.ok ? 'events.list.copied' : 'events.list.copyFailed', { type: copied.type }) : ''}</p>
    <QueryStatus isPending={eventTypes.isPending} error={eventTypes.error} isEmpty={groups.length === 0} emptyTitle={t('events.eventTypes.emptyTitle')} emptyDescription={t('events.eventTypes.emptyDescription')} />
    {groups.map((group) => <ResourceGroup key={group.producer} title={t('events.list.producer', { producer: group.producer })} count={group.count} note={t('events.list.producerNote')}>
      {group.families.map((family) => <FamilyRow key={family.name} family={family} subscribed={subscribed} onCopy={copy} />)}
    </ResourceGroup>)}
    {extra}
  </ResourceList>;
}

function SubscriptionRow({ subscription, current }: { readonly subscription: SubscriptionDto; readonly current: boolean }): ReactElement {
  const t = useT();
  return <ResourceRow title={<BreakableText text={subscription.eventType} />} current={current} meta={<MetaLine parts={[<>→ <code>{subscription.handlerPath}</code></>]} />}
    trailing={<Badge tone={subscription.state === 'active' ? 'success' : 'neutral'}>{t(`events.subscriptionState.${subscription.state}`)}</Badge>} />;
}

/** 一个事件族一行：首行族名（它本身可订阅时点它复制），次行是子类型，每个都能点来复制订阅片段；已订阅的带圆点。 */
function FamilyRow({ family, subscribed, onCopy }: { readonly family: EventFamily; readonly subscribed: readonly SubscriptionDto[]; readonly onCopy: (type: EventTypeDto) => void }): ReactElement {
  const t = useT();
  const isSubscribed = (type: EventTypeDto) => subscribed.some((item) => item.eventTypeId === type.id || item.eventType === type.eventType);
  const self = family.self;
  return <ResourceRow title={<><BreakableText text={family.name} />{self && isSubscribed(self) ? <span className={styles.dot} title={t('events.list.alreadySubscribed')}> ●</span> : null}</>}
    onActivate={self ? () => onCopy(self) : undefined} activateLabel={self ? t('events.list.copy', { type: self.eventType }) : undefined}
    meta={family.leaves.length > 0 ? <span className={styles.leaves}>{family.leaves.map(({ leaf, type }) => <button key={type.id} type="button"
      className={isSubscribed(type) ? `${styles.leaf} ${styles.subscribed}` : styles.leaf} aria-label={t('events.list.copy', { type: type.eventType })}
      title={[isSubscribed(type) ? t('events.list.alreadySubscribed') : '', type.schemaRef ? `Schema ${type.schemaRef}` : ''].filter(Boolean).join(' · ') || undefined}
      onClick={() => onCopy(type)}>{leaf}</button>)}</span> : self?.schemaRef ? `Schema ${self.schemaRef}` : undefined} />;
}
