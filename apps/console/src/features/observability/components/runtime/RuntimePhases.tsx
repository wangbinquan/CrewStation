import {useState,useRef} from 'react';
import type {RuntimePhaseTiming,RuntimePhase,RuntimeReportHeader} from '@crewstation/contracts';
import {useT} from '../../../../shared/lib/useT';
import {ActionRow} from '../../../../shared/ui/ActionRow';
import {Button} from '../../../../shared/ui/Button';
import {Card} from '../../../../shared/ui/Card';
import {Dialog} from '../../../../shared/ui/dialog/Dialog';
import {RuntimeRows} from '../RuntimeRows';
import {runtimeDate} from '../../model/runtimeFormat';
import {runtimePhaseLanes} from '../../model/runtimePhaseLanes';
import {completeDuration,completePercent} from '../../model/completeFormat';
import styles from '../RuntimeStatistics.module.css';
export function RuntimePhases(props:{header:RuntimeReportHeader;taskId:string;totals?:RuntimePhaseTiming}){return <Phases key={JSON.stringify([props.header.reportId,props.taskId])} {...props}/>;}
function Phases({header,taskId,totals}:{header:RuntimeReportHeader;taskId:string;totals?:RuntimePhaseTiming}){
 const t=useT(),[selected,setSelected]=useState<RuntimePhase>(),opener=useRef<HTMLButtonElement>(null);
 return <Card title={t('runtime.phases')} stacked footer={t('runtime.phasesHint')}>
  {totals?<ActionRow>{(['activeMs','activeUnionMs','waitingMs','waitingUnionMs','residenceMs','queueMs','initializationMs','cleanupMs','retentionMs'] as const).map(key=><span key={key}>{t('runtime.phaseTotal.'+key)}: {completeDuration(totals[key])}</span>)}<span>{t('runtime.missingIntervals',{count:totals.unknownSegments})}</span></ActionRow>:null}
  <RuntimeRows<RuntimePhase> header={header} section="phases" parent={taskId}>{rows=>{const times=rows.flatMap(row=>[row.startedAt,row.endedAt].flatMap(at=>at?[Date.parse(at)]:[])),from=totals?.range?Date.parse(totals.range.from):times.length?Math.min(...times):null,to=totals?.range?Date.parse(totals.range.to):times.length?Math.max(...times):null,span=String(from!==null&&to!==null?Math.max(1,to-from):1);return <div className={styles.scroll} role="region" aria-label={t('runtime.phases')} tabIndex={0}><div className={styles.timeline}><div className={styles.range}>{from!==null&&to!==null?<><span>{runtimeDate(new Date(from).toISOString())}</span><span>{runtimeDate(new Date(to).toISOString())}</span></>:<span>{t('runtime.timingUnknown')}</span>}</div>{runtimePhaseLanes(rows).map(lane=><div key={lane.key} className={styles.lane}><div className={styles.laneLabel}>{lane.name??t('runtime.phase.environment')}<span className={styles.identity}>{lane.segments[0]?.agentId}</span></div><div className={styles.phaseTrack}>{lane.segments.map(row=>from!==null&&to!==null&&row.quality==='known'&&row.startedAt&&row.durationMs!==null?<button key={row.key} type="button" className={styles.bar+' '+styles.phaseBar} data-phase={row.kind} style={{left:`${completePercent(String(Math.max(0,Date.parse(row.startedAt)-from)),span)}%`,width:`${completePercent(row.durationMs,span)}%`}} title={`${t('runtime.phase.'+row.kind)} · ${runtimeDate(row.startedAt)} — ${runtimeDate(row.endedAt)}`} onClick={e=>{opener.current=e.currentTarget;setSelected(row);}}>{t('runtime.phase.'+row.kind)} · {completeDuration(row.durationMs)}</button>:<Button key={row.key} size="small" variant="ghost" onClick={e=>{opener.current=e.currentTarget;setSelected(row);}}>{t('runtime.phase.'+row.kind)} · {t('runtime.timingUnknown')}</Button>)}</div></div>)}</div></div>;}}</RuntimeRows>
  {selected?<Dialog title={t('runtime.phase.'+selected.kind)} onClose={()=>setSelected(undefined)} returnFocusTo={opener}><dl className={styles.facts}><dt>{t('runtime.agent')}</dt><dd>{selected.agentName??t('runtime.nameUnavailable')}<span className={styles.identity}>{selected.agentId}</span></dd><dt>{t('runtime.phase.source')}</dt><dd>{selected.source}<span className={styles.identity}>{selected.runtimeTaskId??selected.taskId}</span></dd><dt>{t('runtime.start')}</dt><dd>{runtimeDate(selected.startedAt)}</dd><dt>{t('runtime.end')}</dt><dd>{runtimeDate(selected.endedAt)}</dd><dt>{t('runtime.duration')}</dt><dd>{completeDuration(selected.durationMs)}</dd>{selected.reason?<><dt>{t('runtime.quality')}</dt><dd>{selected.reason}</dd></>:null}</dl></Dialog>:null}
 </Card>;
}
