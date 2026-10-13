import type { RuntimeFragment } from '@crewstation/contracts';
import type {RuntimePhase} from '@crewstation/contracts';
import type {RuntimeAttemptFact,RuntimeTaskHeaderFact,RuntimeReportSection,UsageNativeCapture,RuntimeNativePagedCapture} from '@crewstation/contracts';
import {completeRuntimeMetrics,emptyCompleteRuntimeFold,mergeCompleteRuntimeFold,addCompleteRuntimeAllocation,type CompleteRuntimeFold} from '../../domain/completeRuntimeMetrics';
import {completeObservedIdentity} from '../../domain/completeRuntimeIdentity';
import {completeRuntimeSourceKind} from '../../domain/completeRuntimeCohort';
import type {CompleteRuntimeCohortInput,CompleteDimensionWorking,CompleteCohortTask} from '../../ports/completeRuntimeCohort';
import type {CompleteRuntimeAllocation} from '../../ports/completeRuntimeTask';
import {completeWorkingCache} from '../completeWorkingCache';
import {completeWorkingTraversal,completeWorkingPages} from '../completeWorkingTraversal';
import type {CompleteTimedAttempt} from '../completeRuntimeTiming';
import type {completeReportRows} from './reportRows';
type Dimensions='agents'|'projects'|'profiles'|'models'|'agent-tasks'|'profile-tasks';
function attemptKeys(task:RuntimeTaskHeaderFact,attempt:RuntimeAttemptFact){const sourceKind=completeRuntimeSourceKind(task),agentKey=JSON.stringify([sourceKind,task.projectId,attempt.agentId??attempt.executionId??attempt.id,attempt.profileId,attempt.profileRevision,attempt.kind]),profileKey=JSON.stringify([attempt.profileId,attempt.profileRevision]);return {sourceKind,agentKey,profileKey};}
export function completeRuntimeDimensions(input:Pick<CompleteRuntimeCohortInput,'rows'|'namespace'|'keyOf'|'signal'>,reportRows:ReturnType<typeof completeReportRows>) {
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
    async prefetchAttempts(task:RuntimeTaskHeaderFact,attempts:readonly RuntimeAttemptFact[]){
      const keys=attempts.filter(attempt=>attempt.kind==='agent').map(attempt=>attemptKeys(task,attempt));if(!keys.length)return;
      await seen.prefetch(keys.flatMap(({agentKey,profileKey})=>[JSON.stringify(['agent-task',agentKey,task.id]),JSON.stringify(['profile-task',profileKey,task.id])]).map(input.keyOf));
      const entries:readonly [Dimensions,string[]][]=[['agents',keys.map(k=>k.agentKey)],['profiles',keys.map(k=>k.profileKey)],['agent-tasks',keys.map(k=>JSON.stringify([k.agentKey,task.id]))],['profile-tasks',keys.map(k=>JSON.stringify([k.profileKey,task.id]))]];
      for(const [section,ids]of entries)await cache(section).prefetch(ids.map(input.keyOf));
    },
    async prefetchModels(task:RuntimeTaskHeaderFact,allocations:readonly CompleteRuntimeAllocation[]){
      const keys=allocations.map(value=>({key:JSON.stringify(value.record.original.modelRef),identity:completeObservedIdentity(value.record.original.identity)}));if(!keys.length)return;
      await seen.prefetch(keys.flatMap(({key,identity})=>[JSON.stringify(['model-execution',key,identity]),JSON.stringify(['model-task',key,task.id])]).map(input.keyOf));await cache('models').prefetch(keys.map(row=>input.keyOf(row.key)));
    },
    async attempt(task:RuntimeTaskHeaderFact,attempt:RuntimeAttemptFact,fold:CompleteRuntimeFold) {
      if(attempt.kind!=='agent')return;
      const {sourceKind,agentKey,profileKey}=attemptKeys(task,attempt);
      const common={projectId:task.projectId,projectName:task.projectName??null,agentId:attempt.agentId,profileId:attempt.profileId,profileName:attempt.profileName??null,profileRevision:attempt.profileRevision};
      await merge('agents',agentKey,{...common,key:agentKey,name:attempt.name,kind:attempt.kind,sourceKind},fold,await first(JSON.stringify(['agent-task',agentKey,task.id]))?'1':'0');
      await merge('profiles',profileKey,{key:profileKey,profileId:attempt.profileId,profileName:attempt.profileName??null,profileRevision:attempt.profileRevision},fold,await first(JSON.stringify(['profile-task',profileKey,task.id]))?'1':'0');
      const taskMetadata={taskId:task.id,taskName:task.name,projectId:task.projectId,projectName:task.projectName??null,sourceKind};
      await merge('agent-tasks',JSON.stringify([agentKey,task.id]),{...taskMetadata,parent:agentKey},fold,'1');
      await merge('profile-tasks',JSON.stringify([profileKey,task.id]),{...taskMetadata,parent:profileKey},fold,'1');
    },
    async model(task:RuntimeTaskHeaderFact,allocation:CompleteRuntimeAllocation,visible:boolean) {
      const original=allocation.record.original,key=JSON.stringify(original.modelRef),fold=emptyCompleteRuntimeFold(visible);
      addCompleteRuntimeAllocation(fold,allocation.contribution,allocation.valuation??undefined,allocation.whole===true,original.projection.projectionRevision,!allocation.quality.ambiguous&&!allocation.quality.unavailable);
      if(await first(JSON.stringify(['model-execution',key,completeObservedIdentity(original.identity)]))){fold.executions='1';fold.observedExecutions='1';}
      await merge('models',key,{modelRef:original.modelRef,...(allocation.actualModel?{actualModel:allocation.actualModel}:{})},fold,await first(JSON.stringify(['model-task',key,task.id]))?'1':'0');
    },
    async finish() {
      await seen.flush();
      for(const [section,target]of caches) {
        await target.flush();
        for await(const page of completeWorkingPages<CompleteDimensionWorking>(input.rows,input.namespace+'/dimensions/'+section,input.signal)) {
          await reportRows.prefetchCounts(page.map(row=>({section,parent:section==='agent-tasks'||section==='profile-tasks'?String(row.document.metadata['parent']):null})));
          for(const row of page){
          const entry=row.document,parent=section==='agent-tasks'||section==='profile-tasks'?String(entry.metadata['parent']):null;
          const {parent:_parent,...metadata}=entry.metadata;
          await reportRows.append(section as RuntimeReportSection,parent,entry.key,{...metadata,[parent===null?'tasks':'attempts']:entry.count,metrics:completeRuntimeMetrics(entry.fold)});
          }
        }
      }
    },
  };
}
export async function retainCompleteTaskDimensions(input:Pick<CompleteRuntimeCohortInput,'rows'|'namespace'|'keyOf'|'signal'>,task:CompleteCohortTask,dimensions:ReturnType<typeof completeRuntimeDimensions>,reportRows:ReturnType<typeof completeReportRows>) {
  if(task.build.fragmentsNamespace)for await(const row of completeWorkingTraversal<RuntimeFragment>(input.rows,task.build.fragmentsNamespace,input.signal))await reportRows.append('fragments',task.summary.id,row.key,row.document);
  if(task.build.phasesNamespace)for await(const row of completeWorkingTraversal<RuntimePhase>(input.rows,task.build.phasesNamespace,input.signal))await reportRows.append('phases',task.summary.id,row.key,row.document);
  const attempts=completeWorkingCache<CompleteTimedAttempt>(input.rows,task.build.attemptsNamespace,input.signal);
  await dimensions.merge('projects',task.summary.projectId,{projectId:task.summary.projectId,projectName:task.summary.projectName??null},task.build.fold,'1');
  for await(const page of completeWorkingPages<CompleteTimedAttempt>(input.rows,task.build.attemptsNamespace,input.signal)) {
    const working=new Map((await input.rows.getMany<{fold:CompleteRuntimeFold}>(task.build.attemptsNamespace.replace(/attempt-summaries$/,'attempts'),page.filter(row=>row.document.kind==='agent').map(row=>row.key))).map(row=>[row.key,row.document]));
    await dimensions.prefetchAttempts(task.summary,page.map(row=>row.document));await reportRows.prefetchCounts([{section:'attempts',parent:task.summary.id},{section:'swimlane',parent:task.summary.id}]);
    for(const row of page){
    const attempt=row.document;
    if(attempt.kind==='agent') {
      // The original fold remains in the private attempts namespace, separate from the public DTO.
      const original=working.get(row.key);
      if(!original)throw new Error('Original admitted attempt fold missing');
      await dimensions.attempt(task.summary,attempt,original.fold);
    }
    await reportRows.append('attempts',task.summary.id,row.key,attempt);
    await reportRows.append('swimlane',task.summary.id,row.key,attempt);
    }
  }
  const privateRoot=task.build.attemptsNamespace.replace(/\/attempt-summaries$/,'');
  for await(const page of completeWorkingPages<UsageNativeCapture>(input.rows,privateRoot+'/captures',input.signal)) {
    const identities=page.map(row=>input.keyOf(completeObservedIdentity(row.document.identity)));await attempts.prefetch(identities);await reportRows.prefetchCounts(identities.map(parent=>({section:'captures',parent})));
    for(const row of page){
    const attempt=await attempts.get(input.keyOf(completeObservedIdentity(row.document.identity)));
    if(!attempt)throw new Error('Original native capture admitted attempt missing');
    await reportRows.append('captures',input.keyOf(completeObservedIdentity(row.document.identity)),row.document.id,row.document);
    }
  }
  for await(const page of completeWorkingPages<RuntimeNativePagedCapture>(input.rows,privateRoot+'/native-pages',input.signal)) {
    const identities=page.map(row=>input.keyOf(completeObservedIdentity(row.document.identity)));await attempts.prefetch(identities);await reportRows.prefetchCounts(identities.map(parent=>({section:'native-pages',parent})));
    for(const row of page){
    const attempt=await attempts.get(input.keyOf(completeObservedIdentity(row.document.identity)));
    if(!attempt)throw new Error('Original paged native capture admitted attempt missing');
    await reportRows.append('native-pages',input.keyOf(completeObservedIdentity(row.document.identity)),row.document.id,row.document);
    }
  }
  for await(const page of completeWorkingPages<CompleteRuntimeAllocation>(input.rows,task.build.allocationsNamespace,input.signal)) {
    await dimensions.prefetchModels(task.summary,page.map(row=>row.document));await attempts.prefetch(page.map(row=>input.keyOf(completeObservedIdentity(row.document.record.original.identity))));await reportRows.prefetchCounts([{section:'calls',parent:task.summary.id}]);
    for(const row of page){
    await dimensions.model(task.summary,row.document,task.build.fold.visible);
    const original=row.document.record.original,fold=emptyCompleteRuntimeFold(task.build.fold.visible,'1');fold.observedExecutions='1';
    addCompleteRuntimeAllocation(fold,row.document.contribution,row.document.valuation??undefined,row.document.whole===true,original.projection.projectionRevision,!row.document.quality.ambiguous&&!row.document.quality.unavailable);
    const attemptKey=input.keyOf(completeObservedIdentity(original.identity)),attempt=await attempts.get(attemptKey);
    if(!attempt)throw new Error('Original call admitted attempt missing');
    await reportRows.append('calls',task.summary.id,row.key,{taskId:task.summary.id,projectId:task.summary.projectId,projectName:task.summary.projectName??null,identity:original.identity,sourceId:original.sourceId,recordId:original.recordId,modelRef:original.modelRef,...(row.document.actualModel?{actualModel:row.document.actualModel}:{}),occurredAt:original.occurredAt,scope:original.scope,agentName:attempt.name,profileId:attempt.profileId,profileName:attempt.profileName??null,profileRevision:attempt.profileRevision,metrics:completeRuntimeMetrics(fold)});
    }
  }
}
