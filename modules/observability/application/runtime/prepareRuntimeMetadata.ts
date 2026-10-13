import {jsonHash} from '@crewstation/kernel';
import type {RuntimeMetadataStage} from '../../ports/incrementalRuntimeTasks';
import type {CompleteAttemptWorking} from '../../ports/completeRuntimeTask';
import {completeAttemptIdentity} from '../../domain/completeRuntimeIdentity';
import {emptyCompleteRuntimeFold,completeRuntimeMetrics,mergeCompleteRuntimeFold} from '../../domain/completeRuntimeMetrics';
import {completeWorkingTraversal} from '../completeWorkingTraversal';
import {qualifiedRuntimeRows} from './qualifiedRuntimeRows';
import {enrichQualifiedProfiles} from './enrichQualifiedProfiles';
import {buildCompleteTaskTiming} from '../completeRuntimeTiming';
import {retainRuntimeFragments} from './runtimeFragments';
import {retainRunnerActivityPhases} from './runnerActivityPhases';
import {retainCliActivityPhases} from './cliActivityPhases';
import {runtimePhaseTiming} from './runtimePhaseTiming';
import {enrichRuntimePhases} from './enrichRuntimePhases';
export class RuntimeMetadataQualificationRequired extends Error {override name='RuntimeMetadataQualificationRequired';}
/** Original owner metadata combines with the existing qualified attempt folds, without numerical source access. */
export const prepareRuntimeMetadata:RuntimeMetadataStage=async(input)=>{
  const {original,facts,namespace,rows,snapshotId,asOf,previousAttemptsNamespace,signal}=input;let task=original.task,found=false;
  for(const source of Object.values(facts.tasks)){if(!source)continue;let after:string|null=null;do{const page=await source.next(after);for(const t of page.items){if(found)throw Error('Original metadata task owner is not unique');task={...t,projectName:await facts.projectName(t.projectId)};found=true;}after=page.nextCursor;}while(after!==null);}
  if(task.projectId!==original.task.projectId||jsonHash([task.source?.kind??'business-task',task.source&&'identity' in task.source?task.source.identity:null])!==jsonHash([original.task.source?.kind??'business-task',original.task.source&&'identity' in original.task.source?original.task.source.identity:null]))throw new RuntimeMetadataQualificationRequired('Original ownership changed');
  let after:string|null=null,count=0n;const fold=emptyCompleteRuntimeFold(true),seen=namespace+'/seen';
  do{const page=await facts.attempts(task).next(after);for(const attempt of page.items){signal.throwIfAborted();const key=jsonHash(completeAttemptIdentity(task,attempt)),old=await rows.get<CompleteAttemptWorking>(previousAttemptsNamespace,key);if(old&&(old.attempt.profileId!==attempt.profileId||old.attempt.profileRevision!==attempt.profileRevision))throw new RuntimeMetadataQualificationRequired('Original accepted compute identity changed');
    const value:CompleteAttemptWorking=old?{...old,attempt:{...attempt,profileName:attempt.profileName??old.attempt.profileName}}:{attempt,fold:emptyCompleteRuntimeFold(true,attempt.kind==='agent'?'1':'0'),rawUsage:'0',captures:'0',nativeEmpty:true,nativeComplete:true};if(!old&&attempt.kind==='agent')value.fold.gaps=['usage-missing','native-capture-unobserved'];mergeCompleteRuntimeFold(fold,value.fold);await rows.insert(seen,[{key,document:true}]);await rows.insert(namespace+'/attempts',[{key,document:value}]);await rows.insert(namespace+'/attempt-summaries',[{key,document:{...value.attempt,key,metrics:completeRuntimeMetrics(value.fold)}}]);count++;}after=page.nextCursor;}while(after!==null);
  let prior:string|undefined;for(;;){const page=await rows.page<CompleteAttemptWorking>(previousAttemptsNamespace,prior??null,200),old=page.items;if(!old.length)break;for(const r of old){if(await rows.get(seen,r.key))continue;const value=structuredClone(r.document);if(!value.fold.gaps.includes('attempt-owner-unavailable'))value.fold.gaps.push('attempt-owner-unavailable');mergeCompleteRuntimeFold(fold,value.fold);await rows.insert(namespace+'/attempts',[{key:r.key,document:value}]);await rows.insert(namespace+'/attempt-summaries',[{key:r.key,document:{...value.attempt,key:r.key,metrics:completeRuntimeMetrics(value.fold)}}]);count++;}prior=old.at(-1)!.key;}
  for(const gap of original.fold.gaps)if(!fold.gaps.includes(gap))fold.gaps.push(gap);if(!found)fold.gaps.push('task-owner-unavailable');
  const timing=await buildCompleteTaskTiming({task,asOf:asOf,rows,attemptsNamespace:namespace+'/attempt-summaries',namespace:namespace+'/timing',signal}),fragment=await retainRuntimeFragments({task,snapshotId:snapshotId,namespace,rows,keyOf:jsonHash,signal,...(facts.fragments?{fragments:facts.fragments(task)}:{}),...(facts.activity?{activity:facts.activity(task)}:{})}),phaseSpace=namespace+'/phases';
  if(task.source?.kind==='development-cli'&&facts.activity){const cli=await retainCliActivityPhases({task,reader:facts.activity(task)!,rows,namespace:namespace+'/cli-activity',snapshotId:snapshotId,asOf:asOf,keyOf:jsonHash,signal});for await(const row of completeWorkingTraversal(rows,cli.namespace,signal))await rows.upsert(phaseSpace,[row]);}
  else if(fragment){const driver=await retainRunnerActivityPhases(rows,fragment.namespace,namespace+'/driver-phases',task.id,signal);for await(const row of completeWorkingTraversal(rows,driver.namespace,signal))await rows.upsert(phaseSpace,[row]);}
  for(const document of await facts.lifecycle?.(task,asOf)??[])await rows.upsert(phaseSpace,[{key:document.key,document}]);
  await enrichRuntimePhases(rows,phaseSpace,namespace+'/attempt-summaries',signal);
  const phases=await runtimePhaseTiming(rows,phaseSpace,signal),build={...original.build,task,fold,metrics:completeRuntimeMetrics(fold),attemptCount:String(count),timing,attemptsNamespace:namespace+'/attempt-summaries',allocationsNamespace:namespace+'/no-numerical-allocation',phasesNamespace:phaseSpace,phaseTiming:phases,...(fragment?{fragmentsNamespace:fragment.namespace}:{})};await enrichQualifiedProfiles(rows,build,facts,signal);
  const publicRows=await qualifiedRuntimeRows(rows,build,namespace+'/public',signal),spaces={attempts:namespace+'/attempts','attempt-summaries':build.attemptsNamespace,fragments:fragment?.namespace??namespace+'/no-fragments',phases:phaseSpace,...Object.fromEntries(Object.entries(publicRows.dimensions).filter(([section])=>section!=='models').map(([section,space])=>['dimension-'+section,space])),'public-rows':publicRows.rows,'public-counts':publicRows.counts};
  const {task:_task,fold:_fold,metrics:_metrics,attemptsNamespace:_attempts,allocationsNamespace:_allocations,fragmentsNamespace:_fragments,phasesNamespace:_phases,...metadata}=build;return {task,fold,build:metadata,spaces};
};
