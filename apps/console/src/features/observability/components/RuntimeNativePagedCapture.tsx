import {useState} from 'react';
import type {RuntimeNativePagedCapture,RuntimeReportHeader} from '@crewstation/contracts';
import {useT} from '../../../shared/lib/useT';
import {Button} from '../../../shared/ui/Button';
import {DataTable} from '../../../shared/ui/DataTable';
import {Dialog} from '../../../shared/ui/dialog/Dialog';
import {RuntimeRows} from './RuntimeRows';
import {runtimeDate} from '../model/runtimeFormat';
import {completeCount} from '../model/completeFormat';
import styles from './RuntimeStatistics.module.css';
export function RuntimeNativePagedCaptures({header,attemptId,attemptName}:{header:RuntimeReportHeader;attemptId:string;attemptName?:string}) {
 const t=useT(),[selected,select]=useState<RuntimeNativePagedCapture>();
 const issueLabel=(issue:string)=>{const key='runtime.native.issue.'+issue,value=t(key);return value===key?t('runtime.native.issue.other'):value;};
 const title=(row:RuntimeNativePagedCapture)=>(attemptName??t('runtime.attempt'))+' · '+t('runtime.native.turnNumber',{count:row.turnIndex+1})+' · '+t('runtime.native.phase.'+row.pass.phase);
 return <>
  <RuntimeRows<RuntimeNativePagedCapture> header={header} section="native-pages" parent={attemptId} hideEmpty>{rows=><DataTable columns={['native.turn','native.source','native.originalSteps','native.numeric','native.valuation','native.baselineState','native.preparedAt'].map(key=>t('runtime.'+key))}>{rows.map(row=><tr key={row.id}>
   <td><Button variant="ghost" size="small" onClick={()=>select(row)}>{title(row)}</Button></td><td>{t('runtime.native.source.'+row.sourceState)}</td>
   <td>{completeCount(row.visitedSteps)} / {completeCount(row.counts.steps)}</td><td>{t(row.numericEof?'runtime.native.processing.done':'runtime.native.processing.pending')}{row.heldSteps!=='0'?<span className={styles.identity}>{t('runtime.native.heldCount',{count:completeCount(row.heldSteps)})}</span>:null}{!row.numericEof&&row.previousPopulation?.held&&row.previousPopulation.held!=='0'?<span className={styles.identity}>{t('runtime.native.previousHeldCount',{count:completeCount(row.previousPopulation.held)})}</span>:null}</td>
   <td>{t(row.valuationEof?'runtime.native.processing.done':'runtime.native.processing.pending')}</td><td>{t('runtime.native.baselineState.'+row.baselineState)}</td><td>{runtimeDate(row.preparedAt)}</td>
  </tr>)}</DataTable>}</RuntimeRows>
  {selected?<Dialog title={title(selected)} onClose={()=>select(undefined)}><dl className={styles.facts}>
   <dt>{t('runtime.native.source')}</dt><dd>{t('runtime.native.source.'+selected.sourceState)}</dd><dt>{t('runtime.native.pages')}</dt><dd>{completeCount(selected.pages)}</dd>
   <dt>{t('runtime.native.sessions')}</dt><dd>{completeCount(selected.counts.sessions)}</dd><dt>{t('runtime.native.parts')}</dt><dd>{completeCount(selected.counts.parts)}</dd>
   <dt>{t('runtime.native.paths')}</dt><dd>{t(selected.pathsComplete?'runtime.native.processing.done':'runtime.native.processing.pending')}</dd>
   <dt>{t('runtime.native.baselineState')}</dt><dd>{t('runtime.native.baselineState.'+selected.baselineState)}</dd>
   <dt>{t('runtime.native.originalSteps')}</dt><dd>{completeCount(selected.visitedSteps)} / {completeCount(selected.counts.steps)}</dd><dt>{t('runtime.native.held')}</dt><dd>{completeCount(selected.heldSteps)}</dd>
   {selected.previousPopulation?<><dt>{t('runtime.native.previousVisited')}</dt><dd>{completeCount(selected.previousPopulation.visited)}</dd><dt>{t('runtime.native.previousHeld')}</dt><dd>{completeCount(selected.previousPopulation.held)}</dd>{selected.previousPopulation.issues.length?<><dt>{t('runtime.native.previousIssues')}</dt><dd><ul>{selected.previousPopulation.issues.map(issue=><li key={issue}>{issueLabel(issue)}<span className={styles.identity}>{issue}</span></li>)}</ul></dd></>:null}</>:null}
   <dt>{t('runtime.native.preparedAt')}</dt><dd>{runtimeDate(selected.preparedAt)}</dd><dt>{t('runtime.native.root')}</dt><dd>{selected.pass.rootSessionId}</dd>
   <dt>{t('runtime.native.sourceDigest')}</dt><dd>{selected.sourceDigest}</dd>
   {selected.issues.length?<><dt>{t('runtime.reason')}</dt><dd><ul>{selected.issues.map(issue=><li key={issue}>{issueLabel(issue)}<span className={styles.identity}>{issue}</span></li>)}</ul></dd></>:null}
  </dl></Dialog>:null}
 </>;
}
