import type {RuntimeTaskHeaderFact} from '@crewstation/contracts';
import type {CompleteRuntimeFold} from '../completeRuntimeMetrics';
import type {CompleteTaskTiming} from '../completeRuntimeTiming';
export function runtimeTaskQuality(task:RuntimeTaskHeaderFact,fold:CompleteRuntimeFold,timing:CompleteTaskTiming){
 const reasons=new Set(fold.gaps),completed=(task.source?.kind??'business-task')==='business-task'&&['closed','succeeded','failed','cancelled'].includes(task.state);
 if(timing.intervals.state==='not-ready'||completed&&timing.wallMs===null)reasons.add('timing-missing');return [...reasons];
}
