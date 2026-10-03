import type {CompleteRuntimeTaskSummary,CompleteRuntimeAttemptSummary,CompleteRuntimeCall,RuntimeReportHeader} from '@crewstation/contracts';
import {useT} from '../../../shared/lib/useT';
import {PageHeader} from '../../../shared/ui/PageHeader';
import {Button} from '../../../shared/ui/Button';
import {Stack} from '../../../shared/ui/Stack';
import {Card} from '../../../shared/ui/Card';
import {DataTable} from '../../../shared/ui/DataTable';
import {RuntimeMetrics,RuntimeTokenMetric} from './RuntimeMetrics';
import {RuntimeTimeline} from './RuntimeTimeline';
import {RuntimeRows} from './RuntimeRows';
import {runtimeDate,runtimeTaskName,runtimeAttemptName,runtimeSourceLabel,runtimeComputeLabel} from '../model/runtimeFormat';
import {completeCny} from '../model/completeFormat';
import styles from './RuntimeStatistics.module.css';
export function RuntimeTaskView({task,header,back}:{task:CompleteRuntimeTaskSummary;header:RuntimeReportHeader;back:()=>void}) {
 const t=useT();return <Stack data-runtime-task>
  <PageHeader title={runtimeTaskName(task,t)} description={t('runtime.taskHint')} meta={`${t('runtime.project')}: ${task.projectName??t('runtime.nameUnavailable')} (${task.projectId}) · ${task.id} · ${t('runtime.state.'+task.state)} · ${runtimeDate(header.asOf)}`} actions={<Button size="small" variant="ghost" onClick={back}>{t('runtime.back')}</Button>}/>
  <Card title={runtimeSourceLabel(task.source?.kind,t)}><dl className={styles.facts}><dt>{t(task.source?.kind==='development-agent'?'runtime.executionId':'runtime.task')}</dt><dd>{task.id}</dd>{task.source?.kind==='development-agent'?<><dt>{t('runtime.workspace')}</dt><dd>{task.source.workspaceName??t('runtime.nameUnavailable')}<span className={styles.identity}>{task.source.identity.taskId}</span></dd><dt>{t('runtime.agent')}</dt><dd>{task.source.identity.agentId}</dd></>:null}</dl>{task.source?.kind==='development-agent'?<p className={styles.hint}>{t('runtime.developmentTiming')}</p>:null}</Card>
  <RuntimeMetrics metrics={task.metrics} duration={task.timing.wallMs}/><RuntimeTimeline task={task} header={header}/>
  <Card title={t('runtime.attempts')}><RuntimeRows<CompleteRuntimeAttemptSummary> header={header} section="attempts" parent={task.id}>{rows=><DataTable className={styles.table} columns={['runtime.agent','runtime.attempt','runtime.state','runtime.tokens','runtime.cost'].map(key=>t(key))}>{rows.map(row=><tr key={row.key}><td>{runtimeAttemptName(task,row,t)}<span className={styles.identity}>{runtimeComputeLabel(row,t)}</span></td><td>{row.attempt}</td><td>{t('runtime.state.'+row.state)}</td><td><RuntimeTokenMetric metrics={row.metrics}/></td><td>{completeCny(row.metrics,t)}</td></tr>)}</DataTable>}</RuntimeRows></Card>
  <Card title={t('runtime.calls')}><RuntimeRows<CompleteRuntimeCall> header={header} section="calls" parent={task.id}>{rows=><DataTable className={styles.table} columns={['runtime.agent','runtime.profile','runtime.model','runtime.call','runtime.tokens','runtime.cost'].map(key=>t(key))}>{rows.map(row=><tr key={JSON.stringify([row.identity,row.sourceId,row.recordId])}><td>{row.agentName}<span className={styles.identity}>{row.identity.executionId}</span></td><td>{runtimeComputeLabel(row,t)}</td><td>{row.modelRef??t('runtime.unknown')}</td><td>{row.recordId}<span className={styles.identity}>{row.occurredAt?runtimeDate(row.occurredAt):'—'}</span></td><td><RuntimeTokenMetric metrics={row.metrics}/></td><td>{completeCny(row.metrics,t)}</td></tr>)}</DataTable>}</RuntimeRows></Card>
 </Stack>;
}
