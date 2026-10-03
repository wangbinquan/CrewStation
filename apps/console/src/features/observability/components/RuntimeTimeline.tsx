import {useState,useRef,type RefObject} from 'react';
import type {CompleteRuntimeTaskSummary,CompleteRuntimeAttemptSummary,RuntimeReportHeader} from '@crewstation/contracts';
import {useT} from '../../../shared/lib/useT';
import {Stack} from '../../../shared/ui/Stack';
import {Card} from '../../../shared/ui/Card';
import {Button} from '../../../shared/ui/Button';
import {ActionRow} from '../../../shared/ui/ActionRow';
import {Dialog} from '../../../shared/ui/dialog/Dialog';
import {RuntimeRows,RuntimeItem} from './RuntimeRows';
import {RuntimeMetrics} from './RuntimeMetrics';
import {RuntimeNativeCaptures} from './RuntimeNativeCapture';
import {runtimeDate,runtimeAttemptName,runtimeComputeLabel} from '../model/runtimeFormat';
import {completeCount,completeDuration,completePercent} from '../model/completeFormat';
import styles from './RuntimeStatistics.module.css';
function Lanes({task,rows,select,selectedKey,opener}:{selectedKey?:string;opener:RefObject<HTMLButtonElement|null>;task:CompleteRuntimeTaskSummary;rows:readonly CompleteRuntimeAttemptSummary[];select:(row:CompleteRuntimeAttemptSummary)=>void}) {
 const t=useT(),range=task.timing.range,from=range?Date.parse(range.from):0,to=range?Date.parse(range.to):0,span=String(Math.max(1,to-from));
 return <div className={styles.timeline}><div className={styles.lane}><strong>{t('runtime.attempt')}</strong><div className={styles.range}>{range?<><span>{runtimeDate(range.from)}</span><span>{runtimeDate(range.to)}</span></>:<span>{t('runtime.timingUnknown')}</span>}</div></div>
  {rows.map(row=><div className={styles.lane} key={row.key}><div className={styles.laneLabel}>{runtimeAttemptName(task,row,t)}<span className={styles.identity}>{runtimeComputeLabel(row,t)}</span><span className={styles.identity}>{t('runtime.attemptNumber',{count:row.attempt})} · {t('runtime.state.'+row.state)}</span></div><div className={styles.track}>{range&&row.startedAt!==null&&row.durationMs!==null?<button ref={node=>{if(node&&row.key===selectedKey)opener.current=node;}} type="button" className={[styles.bar,row.state==='failed'?styles.failed:'',row.open?styles.open:''].join(' ')} style={{left:`${completePercent(String(Date.parse(row.startedAt)-from),span)}%`,width:`${completePercent(row.durationMs,span)}%`}} aria-label={`${runtimeAttemptName(task,row,t)} · ${t('runtime.attemptNumber',{count:row.attempt})} · ${completeDuration(row.durationMs)}`} title={completeDuration(row.durationMs)} onClick={()=>select(row)}>{completeDuration(row.durationMs)}</button>:<Button ref={node=>{if(node&&row.key===selectedKey)opener.current=node;}} size="small" variant="ghost" onClick={()=>select(row)}>{t('runtime.timingUnknown')}</Button>}</div></div>)}
 </div>;
}
export function RuntimeTimeline({task,header}:{task:CompleteRuntimeTaskSummary;header:RuntimeReportHeader}) {
 const t=useT(),[selectedKey,select]=useState<string>(),[selectedTitle,setTitle]=useState(''),[zoom,setZoom]=useState(false),opener=useRef<HTMLButtonElement>(null),intervals=task.timing.intervals;
 return <><Card title={t('runtime.timeline')} extra={<Button size="small" variant="ghost" onClick={()=>setZoom(!zoom)}>{t(zoom?'runtime.fit':'runtime.zoom')}</Button>} stacked><p className={styles.hint}>{t('runtime.timelineHint')}</p><div className={styles.scroll} tabIndex={0} role="region" aria-label={t('runtime.timeline')}><div style={{minWidth:zoom?1200:680}}><RuntimeRows<CompleteRuntimeAttemptSummary> header={header} section="swimlane" parent={task.id}>{rows=><Lanes task={task} rows={rows} selectedKey={selectedKey} opener={opener} select={row=>{select(row.key);setTitle(runtimeAttemptName(task,row,t)+' · '+t('runtime.attemptNumber',{count:row.attempt}));}}/>}</RuntimeRows></div></div>
  <ActionRow><span>{t('runtime.cumulative')}: {completeDuration(intervals.state==='complete'?intervals.cumulativeMs:null)}</span><span>{t('runtime.union')}: {completeDuration(intervals.state==='complete'?intervals.activeUnionMs:null)}</span>{intervals.state==='not-ready'?<span>{t('runtime.missingIntervals',{count:completeCount(intervals.unknown)})}</span>:null}</ActionRow>
 </Card>{selectedKey?<Dialog title={selectedTitle} returnFocusTo={opener} size="large" onClose={()=>select(undefined)}><RuntimeItem<CompleteRuntimeAttemptSummary> header={header} section="attempts" parent={task.id} rowKey={selectedKey}>{selected=><Stack><RuntimeMetrics metrics={selected.metrics} duration={selected.durationMs}/>
  <dl className={styles.facts}><dt>{t('runtime.project')}</dt><dd>{task.projectName??t('runtime.nameUnavailable')}</dd><dt>{t('runtime.profile')}</dt><dd>{runtimeComputeLabel(selected,t)}<span className={styles.identity}>{selected.profileId??'—'}</span></dd><dt>{t('runtime.start')}</dt><dd>{selected.startedAt?runtimeDate(selected.startedAt):'—'}</dd><dt>{t('runtime.end')}</dt><dd>{selected.endedAt?runtimeDate(selected.endedAt):t(selected.open?'runtime.runningUntil':'runtime.timingUnknown')}</dd><dt>{t('runtime.executionId')}</dt><dd>{selected.executionId??'—'}</dd></dl>
  {selected.kind==='agent'?<RuntimeNativeCaptures header={header} attemptId={selected.key}/>:null}
 </Stack>}</RuntimeItem></Dialog>:null}</>;
}
