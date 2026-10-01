import type { RuntimeTaskObservation } from '@crewstation/contracts';
import { useT } from '../../../shared/lib/useT';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { Button } from '../../../shared/ui/Button';
import { Stack } from '../../../shared/ui/Stack';
import { Card } from '../../../shared/ui/Card';
import { DataTable } from '../../../shared/ui/DataTable';
import { RuntimeMetrics, RuntimeTokenBuckets, RuntimeTokenMetric } from './RuntimeMetrics';
import { RuntimeTimeline } from './RuntimeTimeline';
import { runtimeCny, runtimeDate, runtimeTaskName, runtimeAttemptName, runtimeSourceLabel } from '../model/runtimeFormat';
import styles from './RuntimeStatistics.module.css';
export function RuntimeTaskView({ task, back }: { task: RuntimeTaskObservation; back: () => void }) {
  const t = useT(); return <Stack data-runtime-task>
    <PageHeader title={runtimeTaskName(task, t)} description={t('runtime.taskHint')} meta={`${t('runtime.project')}: ${task.projectName ?? t('runtime.nameUnavailable')} (${task.projectId}) · ${task.id} · ${t('runtime.state.' + task.state)} · ${runtimeDate(task.asOf)}`} actions={<Button onClick={back}>{t('runtime.back')}</Button>} />
    <Card title={runtimeSourceLabel(task.source?.kind, t)}><dl className={styles.facts}><dt>{t(task.source?.kind === 'development-agent' ? 'runtime.executionId' : 'runtime.task')}</dt><dd>{task.id}</dd>{task.source?.kind === 'development-agent' ? <><dt>{t('runtime.workspace')}</dt><dd>{task.source.workspaceName ?? t('runtime.nameUnavailable')}<span className={styles.identity}>{task.source.identity.taskId}</span></dd><dt>{t('runtime.agent')}</dt><dd>{task.source.identity.agentId}</dd></> : null}</dl>{task.source?.kind === 'development-agent' ? <p className={styles.hint}>{t('runtime.developmentTiming')}</p> : null}</Card>
    {task.partial ? <p role="status" className={styles.notice}>{t('runtime.partial')}</p> : null}
    <RuntimeMetrics metrics={task.metrics} duration={task.wallMs} /><RuntimeTimeline task={task} />
    <Card title={t('runtime.buckets')}><RuntimeTokenBuckets metrics={task.metrics} /></Card>
    <Card title={t('runtime.attempts')}><DataTable className={styles.table} columns={['agent', 'attempt', 'state', 'tokens', 'cost'].map((k) => t('runtime.' + k))}>
      {task.attempts.map((a) => <tr key={a.id}><td>{runtimeAttemptName(task, a, t)}<span className={styles.identity}>{a.profileName ?? t('runtime.nameUnavailable')} · r{a.profileRevision ?? '—'}</span></td><td>{a.attempt}</td><td>{t('runtime.state.' + a.state)}</td><td><RuntimeTokenMetric metrics={a.metrics} /></td><td>{runtimeCny(a.metrics)}</td></tr>)}
    </DataTable></Card>
  </Stack>;
}
