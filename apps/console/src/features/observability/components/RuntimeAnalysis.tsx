import {useRef} from 'react';
import type {RuntimeCompleteSummary,RuntimeReportHeader,CompleteRuntimeTaskSummary} from '@crewstation/contracts';
import {useT} from '../../../shared/lib/useT';
import {Stack} from '../../../shared/ui/Stack';
import {Card} from '../../../shared/ui/Card';
import {Button} from '../../../shared/ui/Button';
import {DataTable} from '../../../shared/ui/DataTable';
import {RuntimeSources} from './RuntimeSources';
import {RuntimeMetrics} from './RuntimeMetrics';
import {RuntimeRows} from './RuntimeRows';
import {RuntimeTaskTable} from './RuntimeTaskTable';
import {RuntimeTrend} from './RuntimeTrend';
import {RuntimeProjects,RuntimeAgents,RuntimeUsage,RuntimeDimensionDetail} from './RuntimeDimensions';
import {completeCount,completeDuration} from '../model/completeFormat';
import type {RuntimeSearch} from '../model/runtimeSearch';
import styles from './RuntimeStatistics.module.css';
interface Props {summary:RuntimeCompleteSummary;header:RuntimeReportHeader;search:RuntimeSearch;change:(next:RuntimeSearch)=>void;task:(id:string)=>void}
function Performance({summary,header,search,change}:Omit<Props,'task'>) {
 const t=useT(),duration=summary.durations;return <Stack>{duration.state==='complete'?<div className={styles.grid}>{(['p50Ms','p95Ms','maxMs'] as const).map(key=><Card key={key} title={t('runtime.'+key)}><p className={styles.value}>{completeDuration(duration[key])}</p><p className={styles.hint}>{t('runtime.samples',{count:completeCount(duration.samples)})}</p></Card>)}</div>:<Card title={t('runtime.timingUnknown')}><p className={styles.hint}>{duration.gaps.map(reason=>t('runtime.reason.'+reason)).join(' · ')}</p></Card>}
 <Card title={t('runtime.quality')}><p>{t('runtime.report.complete')}</p><RuntimeRows<{taskId:string;taskName:string;reason:string}> header={header} section="quality">{rows=><DataTable columns={[t('runtime.reason'),t('runtime.task')]}>{rows.map(row=><tr key={JSON.stringify([row.reason,row.taskId])}><td><Button size="small" variant="ghost" onClick={()=>change({...search,quality:row.reason,tab:'tasks'})}>{t('runtime.reason.'+row.reason)}</Button></td><td>{row.taskName}</td></tr>)}</DataTable>}</RuntimeRows><p className={styles.hint}>{t('runtime.report.noPartial')}</p></Card></Stack>;
}
export function RuntimeAnalysis({summary,header,search,change,task}:Props) {
 const t=useT(),tab=search.tab??'overview',agentOpener=useRef<HTMLButtonElement>(null),profileOpener=useRef<HTMLButtonElement>(null);return <>
  {tab==='overview'?<Stack><RuntimeMetrics metrics={summary.metrics} tasks={summary.tasks} countLabel={t('runtime.objects')}/><RuntimeTrend summary={summary} header={header} search={search} change={change}/><RuntimeSources data={summary} search={search} change={change}/>{header.scope==='system'?<RuntimeProjects header={header} search={search} change={change}/>:null}<Card title={t('runtime.recent')}><RuntimeRows<CompleteRuntimeTaskSummary> header={header} section="tasks">{rows=><RuntimeTaskTable header={header} tasks={rows} open={task}/>}</RuntimeRows></Card></Stack>:null}
  {tab==='tasks'?<Card title={t('runtime.objects')}><RuntimeRows<CompleteRuntimeTaskSummary> header={header} section="tasks">{rows=><RuntimeTaskTable header={header} tasks={rows} open={task}/>}</RuntimeRows></Card>:null}
  {tab==='agents'?<RuntimeAgents opener={agentOpener} header={header} search={search} change={change}/>:null}
  {tab==='usage'?<RuntimeUsage opener={profileOpener} header={header} summary={summary.metrics} search={search} change={change}/>:null}
  {tab==='performance'?<Performance summary={summary} header={header} search={search} change={change}/>:null}
  <RuntimeDimensionDetail opener={search.agent?agentOpener:profileOpener} header={header} search={search} change={change} task={task}/>
 </>;
}
