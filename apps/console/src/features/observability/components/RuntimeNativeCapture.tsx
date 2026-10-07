import {useState} from 'react';
import type {UsageNativeCapture,RuntimeReportHeader} from '@crewstation/contracts';
import {useT} from '../../../shared/lib/useT';
import {Card} from '../../../shared/ui/Card';
import {DataTable} from '../../../shared/ui/DataTable';
import {Button} from '../../../shared/ui/Button';
import {Dialog} from '../../../shared/ui/dialog/Dialog';
import {RuntimeNativePagedCaptures} from './RuntimeNativePagedCapture';
import {RuntimeRows} from './RuntimeRows';
import {runtimeDate} from '../model/runtimeFormat';
import styles from './RuntimeStatistics.module.css';
export function RuntimeNativeCaptures({header,attemptId,attemptName}:{header:RuntimeReportHeader;attemptId:string;attemptName?:string}) {
 const t=useT(),[selected,select]=useState<UsageNativeCapture>();return <>
  <Card title={t('runtime.native.title')} stacked>{header.coverage==='complete'?<RuntimeRows<UsageNativeCapture> header={header} section="captures" parent={attemptId} hideEmpty emptyKey="runtime.reason.native-capture-unobserved">{rows=><DataTable columns={['native.turn','state','native.steps','native.baseline','observed'].map(key=>t('runtime.'+key))}>{rows.map(row=><tr key={row.id}><td><Button size="small" variant="ghost" onClick={()=>select(row)}>{t('runtime.native.turnNumber',{count:row.proof.turnIndex+1})}</Button></td><td>{t('runtime.native.state.'+row.state)}</td><td>{row.receivedSteps} / {row.proof.emitted}</td><td>{row.receivedBaselineSteps} / {row.proof.baselineSteps}</td><td>{runtimeDate(row.proof.observedAt)}</td></tr>)}</DataTable>}</RuntimeRows>:null}<RuntimeNativePagedCaptures header={header} attemptId={attemptId} attemptName={attemptName}/><p className={styles.hint}>{t('runtime.native.hint')}</p></Card>
  {selected?<Dialog title={t('runtime.native.turnNumber',{count:selected.proof.turnIndex+1})} onClose={()=>select(undefined)}><dl className={styles.facts}><dt>{t('runtime.native.root')}</dt><dd>{selected.proof.root??'—'}</dd><dt>{t('runtime.native.unresolved')}</dt><dd>{selected.unresolvedBaselineSteps}</dd><dt>{t('runtime.native.revised')}</dt><dd>{selected.revisedBaselineSteps}</dd><dt>{t('runtime.native.corrected')}</dt><dd>{selected.correctedBaselineSteps??0}</dd><dt>{t('runtime.native.observedAt')}</dt><dd>{runtimeDate(selected.proof.observedAt)}</dd></dl></Dialog>:null}
 </>;
}
