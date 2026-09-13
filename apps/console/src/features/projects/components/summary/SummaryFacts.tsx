import type { ProjectSummary, SlotDto } from '@crewstation/contracts';
import { useT } from '../../../../shared/lib/useT';
import { useDateText } from '../../../../shared/lib/useDateText';
import { Badge } from '../../../../shared/ui/Badge';
import { summaryIsFresh } from '../../model/projectSummaryState';
import { shortSha, slotStateTone } from '../../model/projectStateTone';
import styles from './ProjectSummary.module.css';

export function SummaryUnavailable({ part, health = false }: { readonly part: { status: string; checkedAt: string }; readonly health?: boolean }) {
  const t = useT();
  return <span className={styles.muted}>{t(part.status === 'restricted' ? 'projects.summary.restricted' : !summaryIsFresh(part) ? 'projects.summary.stale' : health ? 'projects.summary.healthUnknown' : 'projects.summary.unknown')}</span>;
}
export function SummaryChecked({ checkedAt }: { readonly checkedAt: string }) {
  const t = useT(), date = useDateText();
  return <small className={styles.muted}>{t('projects.summary.checked', { time: date(checkedAt) })}</small>;
}
export function DevelopmentFact({ item }: { readonly item: ProjectSummary }) {
  const t = useT(), part = item.development;
  if (part.status !== 'ready' || !summaryIsFresh(part)) return <SummaryUnavailable part={part} />;
  const session = part.value;
  return session ? <div className={styles.fact}><span>{t(`projects.summary.session.${session.state}`)}</span>
    <small>{t(session.connected ? 'projects.summary.connected' : 'projects.summary.disconnected')}</small><code>{session.branch ?? t('projects.summary.branchUnknown')}</code>
    {session.message ? <small>{session.message}</small> : null}</div> : <span className={styles.muted}>{t('projects.summary.noSession')}</span>;
}
export function DeploymentFact({ item, name, canOpen = true }: { readonly item: ProjectSummary; readonly name: 'prod' | 'preview'; readonly canOpen?: boolean }) {
  const t = useT(), part = item.slots;
  if (part.status !== 'ready' || !summaryIsFresh(part)) return <SummaryUnavailable part={part} />;
  const slot = part.value.find((s) => s.name === name);
  if (!slot || slot.state === 'empty') return <span className={styles.muted}>{t('projects.summary.notDeployed')}</span>;
  const ready = slot.state === 'ready' && slot.readyReplicas > 0 && slot.releaseId && slot.tag && slot.commitSha;
  return <div className={styles.fact}><span><strong>{slot.tag}</strong> <code title={slot.commitSha}>{shortSha(slot.commitSha)}</code></span>
    <div className={styles.actions}><Badge tone={slotStateTone(slot.state)}>{t(`projects.slotState.${slot.state}`)}</Badge>
    {canOpen && ready && validHost(slot) ? <a href={`//${slot.host}`} target="_blank" rel="noreferrer">{t(name === 'prod' ? 'projects.summary.openProduction' : 'projects.summary.openPreview')}</a> : null}</div>
  </div>;
}
function validHost(slot: SlotDto) { return /^[a-z0-9][a-z0-9.-]*(?::\d+)?$/i.test(slot.host); }
export function HealthFact({ item }: { readonly item: ProjectSummary }) {
  const t = useT(), part = item.health;
  if (part.status !== 'ready' || !summaryIsFresh(part) || part.value.length === 0) return <SummaryUnavailable part={part} health />;
  return <div className={styles.fact}>{part.value.map((h) => <span key={h.slot}>{t(`projects.summary.${h.slot}`)} · {t(`projects.summary.health.${h.state}`)}</span>)}</div>;
}
