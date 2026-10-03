import type {CompleteRuntimeTaskSummary,CompleteRuntimeAttemptSummary,RuntimeReportHeader} from '@crewstation/contracts';
import {useT} from '../../../shared/lib/useT';
import {DataTable} from '../../../shared/ui/DataTable';
import {Dialog} from '../../../shared/ui/dialog/Dialog';
import {RuntimeRows} from './RuntimeRows';
import {RuntimeTokenMetric} from './RuntimeMetrics';
import {runtimeComputeLabel,runtimeAttemptName} from '../model/runtimeFormat';
import {completeCny} from '../model/completeFormat';
import styles from './RuntimeStatistics.module.css';
/** Lazy pages expose every original accepted execution without growing each task-list response. */
export function RuntimeTaskComputes({header,task,close}:{header:RuntimeReportHeader;task:CompleteRuntimeTaskSummary;close:()=>void}) {
 const t=useT();return <Dialog title={task.name+' · '+t('runtime.viewComputes')} size="large" onClose={close}><RuntimeRows<CompleteRuntimeAttemptSummary> header={header} section="attempts" parent={task.id}>{rows=><DataTable columns={['agent','profile','attempt','tokens','cost'].map(key=>t('runtime.'+key))}>{rows.map(row=><tr key={row.key}><td>{runtimeAttemptName(task,row,t)}</td><td>{runtimeComputeLabel(row,t)}<span className={styles.identity}>{row.profileId??'—'}</span></td><td>{row.attempt}</td><td><RuntimeTokenMetric metrics={row.metrics}/></td><td>{completeCny(row.metrics,t)}</td></tr>)}</DataTable>}</RuntimeRows></Dialog>;
}
