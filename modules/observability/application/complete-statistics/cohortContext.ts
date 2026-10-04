import type {RuntimeSourceKind,RuntimeTaskHeaderFact,CompleteRuntimeTaskSummary,RuntimeCompleteSummary} from '@crewstation/contracts';
import {completeTrendFolds,completeRuntimeSourceKind,matchesCompleteRuntimeCohort} from '../../domain/completeRuntimeCohort';
import {emptyCompleteRuntimeFold,mergeCompleteRuntimeFold,completeRuntimeMetrics} from '../../domain/completeRuntimeMetrics';
import {completeDurationSample} from '../../domain/completeRuntimeTiming';
import type {CompleteRuntimeCohortInput,CompleteCohortTask} from '../../ports/completeRuntimeCohort';
import type {CompleteTimedAttempt} from '../completeRuntimeTiming';
import {completeWorkingCache} from '../completeWorkingCache';
import {completeWorkingPages} from '../completeWorkingTraversal';
import {completeReportRows} from './reportRows';
import {completeRuntimeDimensions,retainCompleteTaskDimensions} from './dimensions';
export function completeCohortContext(input:CompleteRuntimeCohortInput) {
  const reportRows=completeReportRows(input),dimensions=completeRuntimeDimensions(input,reportRows),fold=emptyCompleteRuntimeFold(true);
  const names=completeWorkingCache<string|null>(input.rows,input.namespace+'/names',input.signal);
  // A lifetime task lookup has its original birth bin, independent of the list's time window.
  const trends=input.query.taskId?[]:completeTrendFolds(input.query,true),sources=new Map<RuntimeSourceKind,{count:string;fold:ReturnType<typeof emptyCompleteRuntimeFold>}>([['business-task',{count:'0',fold:emptyCompleteRuntimeFold(true)}],['development-agent',{count:'0',fold:emptyCompleteRuntimeFold(true)}]]);
  let count=0n,missingDuration=false;
  const name=async(kind:'project'|'profile',id:string)=>{const key=JSON.stringify([kind,id]),existing=await names.get(key);if(existing!==undefined)return existing;const value=await(kind==='project'?input.facts.projectName(id):input.facts.profileName(id));await names.put(key,value);return value;};
  async function enrich(build:CompleteCohortTask['build']) {
    for await(const page of completeWorkingPages<CompleteTimedAttempt>(input.rows,build.attemptsNamespace,input.signal)) {
      const enriched=[];
      for(const row of page)enriched.push({key:row.key,document:{...row.document,profileName:row.document.profileName??(row.document.profileId?await name('profile',row.document.profileId):null)}});
      await input.rows.upsert(build.attemptsNamespace,enriched);
    }
  }
  return {input,reportRows,dimensions,fold,trends,sources,count:()=>String(count),missingDuration:()=>missingDuration,
    async retain(header:RuntimeTaskHeaderFact) {
      const task={...header,projectName:await name('project',header.projectId)},build=await input.task(task,input.namespace+'/private-tasks/'+input.keyOf(task.id));
      await enrich(build);
      const quality=[...build.fold.gaps];if(build.timing.intervals.state==='not-ready'||completeDurationSample(task)&&build.timing.wallMs===null)quality.push('timing-missing');
      if(!matchesCompleteRuntimeCohort(task,quality,input.query)){await input.rows.clearTree(input.namespace+'/private-tasks/'+input.keyOf(task.id));return;}
      const summary:CompleteRuntimeTaskSummary={...task,attemptCount:build.attemptCount,metrics:build.metrics,timing:build.timing};
      const sourceKind=completeRuntimeSourceKind(task),selected:CompleteCohortTask={build,summary,sourceKind};
      await input.rows.insert(input.namespace+'/tasks',[{key:task.id,document:summary}]);
      await input.rows.insert(input.namespace+'/source-receipts',[{key:task.id,document:build.sourceReceipts}]);
      count++;mergeCompleteRuntimeFold(fold,build.fold);const source=sources.get(sourceKind)!;source.count=String(BigInt(source.count)+1n);mergeCompleteRuntimeFold(source.fold,build.fold);
      const at=Date.parse(task.createdAt);
      if(input.query.taskId&&trends.length===0)trends.push({from:task.createdAt,to:new Date(at+1).toISOString(),count:'0',fold:emptyCompleteRuntimeFold(true)});
      const trend=trends.find(bin=>at>=Date.parse(bin.from)&&at<Date.parse(bin.to));
      if(!trend)throw new Error('Original task falls outside its creation cohort');trend.count=String(BigInt(trend.count)+1n);mergeCompleteRuntimeFold(trend.fold,build.fold);
      if(completeDurationSample(task)){if(build.timing.wallMs===null)missingDuration=true;else await input.rows.insert(input.namespace+'/durations',[{key:task.id,document:build.timing.wallMs}]);}
      await retainCompleteTaskDimensions(input,selected,dimensions,reportRows);
      for(const reason of quality){const document={taskId:task.id,taskName:task.name,projectId:task.projectId,projectName:task.projectName,reason};await reportRows.append('quality',reason,task.id,document);await reportRows.append('quality',null,input.keyOf(JSON.stringify([reason,task.id])),document);}
      await input.rows.clearTree(input.namespace+'/private-tasks/'+input.keyOf(task.id));
    },
    finishSummary(durations:RuntimeCompleteSummary['durations']):RuntimeCompleteSummary {
      return {tasks:String(count),metrics:completeRuntimeMetrics(fold),durations,trend:trends.map(bin=>({from:bin.from,to:bin.to,tasks:bin.count,metrics:completeRuntimeMetrics(bin.fold)})),sources:[...sources].map(([kind,source])=>({kind,tasks:source.count,metrics:completeRuntimeMetrics(source.fold),collectionState:kind==='development-agent'?'production-disabled':'available'}))};
    },
  };
}
