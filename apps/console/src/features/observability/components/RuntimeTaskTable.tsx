import {useState} from 'react';
import type {CompleteRuntimeTaskSummary,RuntimeReportHeader} from '@crewstation/contracts';
import {useT} from '../../../shared/lib/useT';
import {Button} from '../../../shared/ui/Button';
import {DataTable} from '../../../shared/ui/DataTable';
import {RuntimeTokenMetric} from './RuntimeMetrics';
import {runtimeTaskName,runtimeSourceLabel} from '../model/runtimeFormat';
import {completeCny,completeCount,completeDuration} from '../model/completeFormat';
import styles from './RuntimeStatistics.module.css';
import {RuntimeTaskComputes} from './RuntimeTaskComputes';
export function RuntimeTaskTable({tasks,open,header}:{tasks:readonly CompleteRuntimeTaskSummary[];open:(id:string)=>void;header:RuntimeReportHeader}) {
 const t=useT(),[selected,select]=useState<CompleteRuntimeTaskSummary>();return <><DataTable className={styles.table} columns={['task','project','state','attempts','tokens','cost','wall'].map(key=>t('runtime.'+key))}>{tasks.map(row=><tr key={row.id} data-runtime-task-id={row.id}>
  <td><Button size="small" variant="ghost" onClick={()=>open(row.id)}>{runtimeTaskName(row,t)}</Button><span className={styles.identity}>{runtimeSourceLabel(row.source?.kind,t)}</span><span className={styles.identity}>{row.id}</span>{BigInt(row.attemptCount)>0n?<Button size="small" variant="ghost" data-runtime-accepted-profile onClick={()=>select(row)}>{t('runtime.viewComputes')}</Button>:null}</td>
  <td>{row.projectName??t('runtime.nameUnavailable')}<span className={styles.identity}>{row.projectId}</span></td><td>{t('runtime.state.'+row.state)}</td><td>{completeCount(row.attemptCount)}</td><td><RuntimeTokenMetric metrics={row.metrics}/></td><td>{completeCny(row.metrics,t)}</td><td>{completeDuration(row.timing.wallMs)}</td>
 </tr>)}</DataTable>{selected?<RuntimeTaskComputes header={header} task={selected} close={()=>select(undefined)}/>:null}</>;
}
