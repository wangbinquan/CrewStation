import type { ReactElement } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { errorMessage, useApiQuery } from '../../../shared/api/useApi';
import { usePollingRefetch } from '../../../shared/lib/usePollingRefetch';
import { useDateText } from '../../../shared/lib/useDateText';
import { useT } from '../../../shared/lib/useT';
import { useProjectScope } from '../../../shared/project/ProjectScope';
import { PROJECT_PATHS } from '../../../shared/project/projectPaths';
import { releaseTimeline, shortId } from '../../../shared/project/releaseTimeline';
import { useServiceMaintenance } from '../../../shared/project/useServiceMaintenance';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { Button } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { Timeline } from '../../../shared/ui/Timeline';
import type { TimelineItem } from '../../../shared/ui/Timeline';
import { isInFlight, releaseStatusTone } from '../model/releaseStatus';
import { lifecycleTimelineItem } from './lifecycleTimelineItem';
import { ReleaseStatusBadge } from './ReleaseStatusBadge';
import styles from './ReleaseTimeline.module.css';
import { ButtonLink } from '../../../shared/ui/navigation/ButtonLink';

/** 当前页前台有界刷新，以发现其他人新发起的发布；后台暂停。 */
const HISTORY_POLL_MS = 5_000;

interface ReleaseTimelineProps {
  readonly projectId: string;
  readonly serviceId: string;
  readonly onSelect: (releaseId: string) => void;
  /** 负责人与管理员：可以重新部署的发布带「重新部署」（RFC-021 M5、M10）。 */
  readonly onRedeploy?: (releaseId: string) => void;
}

/**
 * 发布与切流合并成一条按时间倒序的记录（RFC-020 D5），并入待命槽的下线／重新部署／推迟／提醒与维护的进入／调整／退出（RFC-021 B8）：
 * 人名与标签代替 UUID，失败条目带构建日志入口，标签即详情入口。某类记录读不到时只列其余几类并说明；成员名单读不到时操作人退回短 ID。
 */
export function ReleaseTimeline({ projectId, serviceId, onSelect, onRedeploy }: ReleaseTimelineProps): ReactElement {
  const t = useT(), date = useDateText(), { space } = useProjectScope();
  const releases = useApiQuery(queryKeys.releases(serviceId), () => api.services.listReleases(serviceId));
  const switches = useApiQuery(queryKeys.trafficSwitches(serviceId), () => api.services.listTrafficSwitches(serviceId));
  const slotEvents = useApiQuery(queryKeys.slotEvents(serviceId), () => api.services.listSlotEvents(serviceId));
  const maintenance = useServiceMaintenance(serviceId);
  const members = useApiQuery(queryKeys.members(projectId), () => api.projects.listMembers(projectId));
  const me = useApiQuery(queryKeys.me(), () => api.me.get());
  usePollingRefetch(releases.refetch, HISTORY_POLL_MS);
  const releaseItems = releases.error ? [] : releases.data?.items ?? [], switchItems = switches.error ? [] : switches.data?.items ?? [];
  const names = new Map<string, string>();
  for (const member of members.data?.items ?? []) names.set(member.userId, member.name);
  if (me.data) names.set(me.data.id, me.data.name);
  const entries = releaseTimeline(releaseItems, switchItems, names, { slotEvents: slotEvents.error ? [] : slotEvents.data?.items ?? [], maintenance: maintenance.history });
  const running = releaseItems.some((release) => isInFlight(release.status));
  const items: TimelineItem[] = entries.map((entry) => entry.kind === 'release'
    ? { id: entry.id, tone: releaseStatusTone(entry.release.status), time: date(entry.at),
      primary: <><Button variant="ghost" className={styles.tag} title={t('release.timeline.details')} onClick={() => onSelect(entry.release.id)}>{entry.release.tag}</Button> <ReleaseStatusBadge status={entry.release.status} /></>,
      secondary: <>{entry.release.slot ? `${t(`slot.${entry.release.slot}`)} · ` : ''}<code>{entry.release.commitSha.slice(0, 7)}</code> · {entry.release.branch}
        {entry.release.status === 'failed' && entry.release.message ? <span className={styles.failure}> · {t('release.history.failureLabel')}{entry.release.message}</span> : null}</>,
      action: <>{entry.release.status === 'failed' ? <ButtonLink size="small" to={PROJECT_PATHS[space].operations} params={{ projectId }} search={{ tab: 'logs', source: 'build', releaseId: entry.release.id }}>{t('release.timeline.logs')}</ButtonLink> : null}
        {onRedeploy && entry.release.redeployable ? <Button size="small" onClick={() => onRedeploy(entry.release.id)}>{t('release.redeploy.short')}</Button> : null}</> }
    : entry.kind === 'switch' ? { id: entry.id, tone: 'info', shape: 'square', time: date(entry.at),
      primary: t(entry.rollback ? 'timeline.rollback' : 'timeline.switch', { actor: entry.actorName ?? t('timeline.unknownActor', { id: shortId(entry.entry.actorUserId) }), tag: entry.tag ?? t('timeline.unknownTag', { id: shortId(entry.entry.releaseId) }) }),
      secondary: entry.entry.reason ? t('timeline.reason', { reason: entry.entry.reason }) : undefined,
      action: <Button size="small" onClick={() => onSelect(entry.entry.releaseId)}>{t('release.timeline.details')}</Button> }
    : lifecycleTimelineItem(entry, t, date));
  const loading = releases.isPending || switches.isPending;
  return <Card title={t('release.timeline.title')} extra={running ? <span className={styles.polling}>{t('release.history.polling')}</span> : undefined}>
    {loading ? <p className={styles.muted}>{t('release.history.loading')}</p> : null}
    {releases.error ? <ActionNote tone="error">{t('release.timeline.releasesUnavailable', { message: errorMessage(releases.error) })}</ActionNote> : null}
    {switches.error ? <ActionNote tone="error">{t('release.timeline.switchesUnavailable', { message: errorMessage(switches.error) })}</ActionNote> : null}
    {slotEvents.error || maintenance.query.error ? <ActionNote tone="error">{t('release.timeline.lifecycleUnavailable', { message: errorMessage(slotEvents.error ?? maintenance.query.error) })}</ActionNote> : null}
    {members.error ? <p className={styles.muted}>{t('release.timeline.namesUnavailable')}</p> : null}
    {!loading && !releases.error && !switches.error && items.length === 0 ? <EmptyState title={t('release.history.empty')} description={t('release.history.emptyDescription')} /> : null}
    {items.length > 0 ? <Timeline items={items} label={t('release.timeline.title')} /> : null}
  </Card>;
}
