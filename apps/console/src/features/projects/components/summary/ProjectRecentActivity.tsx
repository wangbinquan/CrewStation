import type { ProjectSummaryDetail } from '@crewstation/contracts';
import { Link } from '@tanstack/react-router';
import { PROJECT_PATHS } from '../../../../shared/project/projectPaths';
import type { ProjectSpace } from '../../../../shared/project/projectPaths';
import { isReleaseOrSwitch, releaseTimeline, shortId } from '../../../../shared/project/releaseTimeline';
import { useT } from '../../../../shared/lib/useT';
import { useDateText } from '../../../../shared/lib/useDateText';
import { Badge } from '../../../../shared/ui/Badge';
import { Card } from '../../../../shared/ui/Card';
import { Timeline } from '../../../../shared/ui/Timeline';
import type { TimelineItem } from '../../../../shared/ui/Timeline';
import { summaryIsFresh } from '../../model/projectSummaryState';
import { SummaryUnavailable } from './SummaryFacts';
import styles from './ProjectSummary.module.css';
import { ButtonLink } from '../../../../shared/ui/navigation/ButtonLink';

const LIMIT = 5;

/** 最近动态：发布与上线／回退合并成一条时间线（RFC-020 D5），人名与标签代替 UUID；完整记录在发布页。 */
export function ProjectRecentActivity({ item, space, names }: { readonly item: ProjectSummaryDetail; readonly space: ProjectSpace; readonly names: ReadonlyMap<string, string> }) {
  const t = useT(), date = useDateText(), params = { projectId: item.project.id };
  const releases = item.releases.status === 'ready' && summaryIsFresh(item.releases) ? item.releases.value : undefined;
  const switches = item.switches.status === 'ready' && summaryIsFresh(item.switches) ? item.switches.value : undefined;
  const entries = releaseTimeline(releases ?? [], switches ?? [], names).filter(isReleaseOrSwitch).slice(0, LIMIT);
  const items: TimelineItem[] = entries.map((entry) => entry.kind === 'release'
    ? { id: entry.id, tone: entry.release.status === 'ready' ? 'success' : entry.release.status === 'failed' ? 'danger' : 'info', time: date(entry.at),
      primary: <Link to={PROJECT_PATHS[space].release} params={params} search={{ release: entry.release.id }}>{entry.release.tag}</Link>,
      secondary: <><Badge tone={entry.release.status === 'ready' ? 'success' : entry.release.status === 'failed' ? 'danger' : 'info'}>{t(`release.status.${entry.release.status}`)}</Badge>{entry.release.slot ? ` · ${t(`slot.${entry.release.slot}`)}` : ''}{entry.release.status === 'failed' && entry.release.message ? ` · ${entry.release.message}` : ''}</> }
    : { id: entry.id, tone: 'info', shape: 'square', time: date(entry.at),
      primary: <Link to={PROJECT_PATHS[space].release} params={params} search={{ release: entry.entry.releaseId }}>{t(entry.rollback ? 'timeline.rollback' : 'timeline.switch', { actor: entry.actorName ?? t('timeline.unknownActor', { id: shortId(entry.entry.actorUserId) }), tag: entry.tag ?? t('timeline.unknownTag', { id: shortId(entry.entry.releaseId) }) })}</Link>,
      secondary: entry.entry.reason ? t('timeline.reason', { reason: entry.entry.reason }) : undefined });
  return <Card compact title={t('projects.summary.activity')} extra={<ButtonLink size="small" to={PROJECT_PATHS[space].release} params={params}>{t('projects.summary.activityAll')}</ButtonLink>}>
    {!releases ? <SummaryUnavailable part={item.releases} /> : !switches ? <SummaryUnavailable part={item.switches} /> : null}
    {releases && switches && items.length === 0 ? <p className={styles.muted}>{t('projects.summary.noActivity')}</p> : null}
    {items.length > 0 ? <Timeline items={items} label={t('projects.summary.activity')} /> : null}
  </Card>;
}
