import type {RuntimeAttemptFact,RuntimeTaskHeaderFact,RuntimeReportSection,UsageNativeCapture} from '@crewstation/contracts';
import {completeRuntimeMetrics,emptyCompleteRuntimeFold,mergeCompleteRuntimeFold,addCompleteRuntimeAllocation,type CompleteRuntimeFold} from '../../domain/completeRuntimeMetrics';
import {completeObservedIdentity} from '../../domain/completeRuntimeIdentity';
import {completeRuntimeSourceKind} from '../../domain/completeRuntimeCohort';
import type {CompleteRuntimeCohortInput,CompleteDimensionWorking,CompleteCohortTask} from '../../ports/completeRuntimeCohort';
import type {CompleteRuntimeAllocation} from '../../ports/completeRuntimeTask';
import {completeWorkingCache} from '../completeWorkingCache';
import {completeWorkingTraversal} from '../completeWorkingTraversal';
import type {CompleteTimedAttempt} from '../completeRuntimeTiming';
import type {completeReportRows} from './reportRows';
type Dimensions='agents'|'projects'|'profiles'|'models'|'agent-tasks'|'profile-tasks';
export function completeRuntimeDimensions(input:CompleteRuntimeCohortInput,reportRows:ReturnType<typeof completeReportRows>) {
  const caches=new Map<Dimensions,ReturnType<typeof completeWorkingCache<CompleteDimensionWorking>>>();
  const seen=completeWorkingCache<boolean>(input.rows,input.namespace+'/dimension-executions',input.signal);
  const cache=(section:Dimensions)=>{
    let result=caches.get(section);if(!result){result=completeWorkingCache(input.rows,input.namespace+'/dimensions/'+section,input.signal);caches.set(section,result);}return result;
  };
  const merge=async(section:Dimensions,key:string,metadata:Readonly<Record<string,unknown>>,fold:CompleteRuntimeFold,countDelta:string)=>{
    const id=input.keyOf(key),target=cache(section);
    const entry=await target.get(id)??{key,metadata,fold:emptyCompleteRuntimeFold(fold.visible),count:'0'};
    if(entry.key!==key) throw new Error('Complete dimension identity changed');
    mergeCompleteRuntimeFold(entry.fold,fold);entry.count=String(BigInt(entry.count)+BigInt(countDelta));await target.put(id,entry);
  };
  const first=async(key:string)=>{const id=input.keyOf(key);if(await seen.get(id))return false;await seen.put(id,true);return true;};
  return {merge,first,
    async attempt(task:RuntimeTaskHeaderFact,attempt:RuntimeAttemptFact,fold:CompleteRuntimeFold) {
      if(attempt.kind!=='agent')return;
      const sourceKind=completeRuntimeSourceKind(task),agentKey=JSON.stringify([sourceKind,task.projectId,attempt.agentId??attempt.executionId??attempt.id,attempt.profileId,attempt.profileRevision,attempt.kind]);
      const profileKey=JSON.stringify([attempt.profileId,attempt.profileRevision]);
      const common={projectId:task.projectId,projectName:task.projectName??null,agentId:attempt.agentId,profileId:attempt.profileId,profileName:attempt.profileName??null,profileRevision:attempt.profileRevision};
      await merge('agents',agentKey,{...common,key:agentKey,name:attempt.name,kind:attempt.kind,sourceKind},fold,await first(JSON.stringify(['agent-task',agentKey,task.id]))?'1':'0');
      await merge('profiles',profileKey,{key:profileKey,profileId:attempt.profileId,profileName:attempt.profileName??null,profileRevision:attempt.profileRevision},fold,await first(JSON.stringify(['profile-task',profileKey,task.id]))?'1':'0');
      const taskMetadata={taskId:task.id,taskName:task.name,projectId:task.projectId,projectName:task.projectName??null,sourceKind};
      await merge('agent-tasks',JSON.stringify([agentKey,task.id]),{...taskMetadata,parent:agentKey},fold,'1');
      await merge('profile-tasks',JSON.stringify([profileKey,task.id]),{...taskMetadata,parent:profileKey},fold,'1');
    },
    async model(task:RuntimeTaskHeaderFact,allocation:CompleteRuntimeAllocation,visible:boolean) {
      const original=allocation.record.original,key=JSON.stringify(original.modelRef),fold=emptyCompleteRuntimeFold(visible);
      addCompleteRuntimeAllocation(fold,allocation.contribution,allocation.valuation??undefined,allocation.whole===true,original.projection.projectionRevision);
      if(await first(JSON.stringify(['model-execution',key,completeObservedIdentity(original.identity)]))){fold.executions='1';fold.observedExecutions='1';}
      await merge('models',key,{modelRef:original.modelRef},fold,await first(JSON.stringify(['model-task',key,task.id]))?'1':'0');
    },
    async finish() {
      await seen.flush();
      for(const [section,target]of caches) {
        await target.flush();
        for await(const row of completeWorkingTraversal<CompleteDimensionWorking>(input.rows,input.namespace+'/dimensions/'+section,input.signal)) {
          const entry=row.document,parent=section==='agent-tasks'||section==='profile-tasks'?String(entry.metadata['parent']):null;
          const {parent:_parent,...metadata}=entry.metadata;
          await reportRows.append(section as RuntimeReportSection,parent,entry.key,{...metadata,[parent===null?'tasks':'attempts']:entry.count,metrics:completeRuntimeMetrics(entry.fold)});
        }
      }
    },
  };
}
export async function retainCompleteTaskDimensions(input:CompleteRuntimeCohortInput,task:CompleteCohortTask,dimensions:ReturnType<typeof completeRuntimeDimensions>,reportRows:ReturnType<typeof completeReportRows>) {
  const attempts=completeWorkingCache<CompleteTimedAttempt>(input.rows,task.build.attemptsNamespace,input.signal);
  await dimensions.merge('projects',task.summary.projectId,{projectId:task.summary.projectId,projectName:task.summary.projectName??null},task.build.fold,'1');
  for await(const row of completeWorkingTraversal<CompleteTimedAttempt>(input.rows,task.build.attemptsNamespace,input.signal)) {
    const attempt=row.document;
    if(attempt.kind==='agent') {
      // The original fold remains in the private attempts namespace, separate from the public DTO.
      const working=await input.rows.get<{fold:CompleteRuntimeFold}>(task.build.attemptsNamespace.replace(/attempt-summaries$/,'attempts'),row.key);
      if(!working)throw new Error('Original admitted attempt fold missing');
      await dimensions.attempt(task.summary,attempt,working.fold);
    }
    await reportRows.append('attempts',task.summary.id,row.key,attempt);
    await reportRows.append('swimlane',task.summary.id,row.key,attempt);
  }
  const privateRoot=task.build.attemptsNamespace.replace(/\/attempt-summaries$/,'');
  for await(const row of completeWorkingTraversal<UsageNativeCapture>(input.rows,privateRoot+'/captures',input.signal)) {
    const attempt=await attempts.get(input.keyOf(completeObservedIdentity(row.document.identity)));
    if(!attempt)throw new Error('Original native capture admitted attempt missing');
    await reportRows.append('captures',input.keyOf(completeObservedIdentity(row.document.identity)),row.document.id,row.document);
  }
  for await(const row of completeWorkingTraversal<CompleteRuntimeAllocation>(input.rows,task.build.allocationsNamespace,input.signal)) {
    await dimensions.model(task.summary,row.document,task.build.fold.visible);
    const original=row.document.record.original,fold=emptyCompleteRuntimeFold(task.build.fold.visible,'1');fold.observedExecutions='1';
    addCompleteRuntimeAllocation(fold,row.document.contribution,row.document.valuation??undefined,row.document.whole===true,original.projection.projectionRevision);
    const attemptKey=input.keyOf(completeObservedIdentity(original.identity)),attempt=await attempts.get(attemptKey);
    if(!attempt)throw new Error('Original call admitted attempt missing');
    await reportRows.append('calls',task.summary.id,row.key,{taskId:task.summary.id,projectId:task.summary.projectId,projectName:task.summary.projectName??null,identity:original.identity,sourceId:original.sourceId,recordId:original.recordId,modelRef:original.modelRef,occurredAt:original.occurredAt,scope:original.scope,agentName:attempt.name,profileId:attempt.profileId,profileName:attempt.profileName??null,profileRevision:attempt.profileRevision,metrics:completeRuntimeMetrics(fold)});
  }
}
