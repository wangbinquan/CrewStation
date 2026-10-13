import {enrichQualifiedProfiles} from './enrichQualifiedProfiles';
import type {RuntimePublicRowStage} from '../../ports/incrementalRuntimeTasks';
import {runtimeTaskQuality} from '../../domain/runtime/runtimeTaskQuality';
import {jsonHash} from '@crewstation/kernel';
import type {CompleteWorkingRows} from '../../ports/completeWorkingRows';
import type {CompleteRuntimeTaskBuild} from '../../ports/completeRuntimeTask';
import type {CompleteRuntimeTaskSummary,RuntimeSourceKind} from '@crewstation/contracts';
import {completeRuntimeDimensions,retainCompleteTaskDimensions} from '../complete-statistics/dimensions';
import {completeReportRows} from '../complete-statistics/reportRows';
/** Build public rows and small dimension folds once per qualification, independently of every requested period. */
export async function qualifiedRuntimeRows(rows:CompleteWorkingRows,build:CompleteRuntimeTaskBuild,namespace:string,signal:AbortSignal){
 const input={rows,namespace,keyOf:jsonHash,signal},output=completeReportRows(input),dimensions=completeRuntimeDimensions(input,output);
 const summary:CompleteRuntimeTaskSummary={...build.task,attemptCount:build.attemptCount,metrics:build.metrics,timing:build.timing,...(build.phaseTiming?{phaseTiming:build.phaseTiming}:{})};
 await retainCompleteTaskDimensions(input,{build,summary,sourceKind:(build.task.source?.kind??'business-task') as RuntimeSourceKind},dimensions,output);await dimensions.finish();for(const reason of runtimeTaskQuality(build.task,build.fold,build.timing)){const document={taskId:build.task.id,taskName:build.task.name,projectId:build.task.projectId,projectName:build.task.projectName??null,reason};await output.append('quality',reason,build.task.id,document);await output.append('quality',null,jsonHash(JSON.stringify([reason,build.task.id])),document);}await output.finalizeCounts();
 return {rows:output.namespace,counts:output.countsNamespace,dimensions:Object.fromEntries(['projects','agents','profiles','models','agent-tasks','profile-tasks'].map(section=>[section,namespace+'/dimensions/'+section]))};
}

export const prepareRuntimePublicRows:RuntimePublicRowStage=async(rows,build,facts,namespace,signal)=>{await enrichQualifiedProfiles(rows,build,facts,signal);return qualifiedRuntimeRows(rows,build,namespace,signal);};
