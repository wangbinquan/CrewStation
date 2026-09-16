import type { ProjectSummaryDetail, SlotDto } from '@crewstation/contracts';
import { useT } from '../../../../shared/lib/useT';
import { Badge } from '../../../../shared/ui/Badge';
import { summaryIsFresh } from '../../model/projectSummaryState';
import { shortSha, slotStateTone } from '../../model/projectStateTone';
import { SummaryChecked, SummaryUnavailable } from './SummaryFacts';
import styles from './ProjectSummary.module.css';

/** 概览里的版本卡：标签作标题，提交、副本与地址一行，访问入口只在实际就绪时出现（设计附件 §概览）。 */
export function DeploymentCard({ item, name, canOpen }: { readonly item: ProjectSummaryDetail; readonly name: 'prod' | 'preview'; readonly canOpen: boolean }) {
  const t = useT();
  const part = name === 'preview' && item.role === 'tester' ? item.preview : item.slots;
  const slot = part?.status === 'ready' && summaryIsFresh(part) ? (Array.isArray(part.value) ? part.value.find((s) => s.name === name) : part.value ?? undefined) : undefined;
  return <section className={styles.versionCard} aria-label={t(`projects.summary.${name}`)}>
    <div className={styles.versionHead}><span className={styles.versionTitle}>{t(`projects.summary.${name}`)}</span>
      {slot && slot.state !== 'empty' ? <Badge tone={slotStateTone(slot.state)}>{t(`projects.slotState.${slot.state}`)}</Badge> : null}</div>
    {!part ? <span className={styles.muted}>{t('projects.summary.unknown')}</span>
      : part.status !== 'ready' || !summaryIsFresh(part) ? <SummaryUnavailable part={part} />
      : !slot || slot.state === 'empty' ? <p className={styles.versionEmpty}>{t('projects.summary.notDeployed')}</p>
      : <DeploymentBody slot={slot} name={name} canOpen={canOpen} />}
    {part ? <SummaryChecked checkedAt={part.checkedAt} /> : null}
  </section>;
}

function DeploymentBody({ slot, name, canOpen }: { readonly slot: SlotDto; readonly name: 'prod' | 'preview'; readonly canOpen: boolean }) {
  const t = useT();
  const ready = slot.state === 'ready' && slot.readyReplicas > 0 && slot.releaseId && slot.tag && slot.commitSha;
  return <>
    <div className={styles.versionTag}>{slot.tag ?? t('projects.summary.unknown')}</div>
    <div className={styles.muted}><code title={slot.commitSha}>{shortSha(slot.commitSha)}</code> · {t('projects.summary.replicasReady', { ready: slot.readyReplicas, total: slot.replicas })}</div>
    <div className={styles.versionFooter}><span className={styles.muted}>{slot.host}</span>
      {canOpen && ready && validHost(slot) ? <a className={styles.linkButton} href={`//${slot.host}`} target="_blank" rel="noreferrer">{t(name === 'prod' ? 'projects.summary.openProduction' : 'projects.summary.openPreview')}</a> : null}</div>
  </>;
}

function validHost(slot: SlotDto) { return /^[a-z0-9][a-z0-9.-]*(?::\d+)?$/i.test(slot.host); }
