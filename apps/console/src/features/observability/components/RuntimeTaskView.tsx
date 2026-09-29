import type { RuntimeTaskObservation } from '@crewstation/contracts';
import { useT } from '../../../shared/lib/useT';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { Button } from '../../../shared/ui/Button';
import { Stack } from '../../../shared/ui/Stack';
import { Card } from '../../../shared/ui/Card';
import { DataTable } from '../../../shared/ui/DataTable';
import { RuntimeMetrics, RuntimeTokenBuckets } from './RuntimeMetrics';
import { RuntimeTimeline } from './RuntimeTimeline';
import { runtimeTokens, runtimeCny, runtimeDate } from '../model/runtimeFormat';
import styles from './RuntimeStatistics.module.css';
export function RuntimeTaskView({ task, back }: { task: RuntimeTaskObservation; back: () => void }) {
  const t = useT(); return <Stack data-runtime-task>
    <PageHeader title={task.name} description={t('runtime.taskHint')} meta={`${t('runtime.project')}: ${task.projectName ?? t('runtime.nameUnavailable')} (${task.projectId}) · ${task.id} · ${t('runtime.state.' + task.state)} · ${runtimeDate(task.asOf)}`} actions={<Button onClick={back}>{t('runtime.back')}</Button>} />
    {task.partial ? <p role="status" className={styles.notice}>{t('runtime.partial')}</p> : null}
    <RuntimeMetrics metrics={task.metrics} duration={task.wallMs} /><RuntimeTimeline task={task} />
    <Card title={t('runtime.buckets')}><RuntimeTokenBuckets metrics={task.metrics} /></Card>
    <Card title={t('runtime.attempts')}><DataTable className={styles.table} columns={['agent', 'attempt', 'state', 'tokens', 'cost'].map((k) => t('runtime.' + k))}>
      {task.attempts.map((a) => <tr key={a.id}><td>{a.name}<span className={styles.identity}>{a.profileName ?? t('runtime.nameUnavailable')} · r{a.profileRevision ?? '—'}</span></td><td>{a.attempt}</td><td>{t('runtime.state.' + a.state)}</td><td>{runtimeTokens(a.metrics)}</td><td>{runtimeCny(a.metrics)}</td></tr>)}
    </DataTable></Card>
  </Stack>;
}
