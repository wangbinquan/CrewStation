import type { RuntimeAggregate } from '@crewstation/contracts';
import {useRuntimeAggregate} from '../hooks/useRuntimeAggregate';
import {RuntimeMetrics} from '../components/RuntimeMetrics';
import {RuntimeTrend} from '../components/RuntimeTrend';
import { rememberRuntimeList, runtimeReturnKey, useRuntimeListReturn } from '../hooks/useRuntimeListReturn';
import { useState } from 'react';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import {runtimeCompleteReportContent,type CompleteRuntimeTaskSummary} from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { isApiClientError } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { useProjectScope } from '../../../shared/project/ProjectScope';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { Stack } from '../../../shared/ui/Stack';
import { Button } from '../../../shared/ui/Button';
import { ActionRow } from '../../../shared/ui/ActionRow';
import { Tabs } from '../../../shared/ui/Tabs';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { ButtonLink } from '../../../shared/ui/navigation/ButtonLink';
import type { ReactNode } from 'react';
import { RuntimeResourceMetrics } from '../components/RuntimeResourceMetrics';
import { RuntimeHealth } from '../components/RuntimeHealth';
import { RuntimeAnalysis } from '../components/RuntimeAnalysis';
import { RuntimeFilters } from '../components/RuntimeFilters';
import { RuntimeSourceFilter } from '../components/RuntimeSources';
import { RuntimeTaskView } from '../components/RuntimeTaskView';
import {useRuntimeReport} from '../hooks/useRuntimeReport';
import {RuntimeReportState} from '../components/RuntimeReportState';
import {RuntimeItem} from '../components/RuntimeRows';
import { RUNTIME_TABS, parseRuntimeSearch, runtimeWindow, type RuntimeSearch } from '../model/runtimeSearch';
import { runtimeDate } from '../model/runtimeFormat';
import styles from '../components/RuntimeStatistics.module.css';

interface PageProps {projectId?:string;taskId?:string;go:(search:RuntimeSearch,taskId?:string)=>void}
function RuntimeViewTabs({projectId,search,change,children}:{projectId?:string;search:RuntimeSearch;change:(next:RuntimeSearch)=>void;children:ReactNode}) {
 const t=useT();return <Tabs label={t('runtime.title')} value={search.tab??'overview'} items={RUNTIME_TABS.map(tab=>({value:tab,label:t(tab==='health'&&!projectId?'runtime.tab.platform':'runtime.tab.'+tab)}))} onChange={tab=>change({...search,tab:RUNTIME_TABS.find(value=>value===tab)})}>{children}</Tabs>;
}
function RuntimeReportRecovery({error,search,rebuild}:{error:unknown;search:RuntimeSearch;rebuild:()=>void}) {
 const t=useT();
 if(!search.reportId||!isApiClientError(error)||error.status!==404||error.kind!=='not_found')return null;
 return <ActionRow><Button size="small" variant="secondary" onClick={rebuild}>{t('runtime.report.rebuild')}</Button></ActionRow>;
}
function RuntimeTaskPage({projectId,taskId,go}:PageProps&{taskId:string}) {
 const t=useT(),search=parseRuntimeSearch(useSearch({strict:false}));
 const query=useRuntimeReport(['task',projectId??'system',taskId],()=>projectId?api.observability.projectRuntimeTask(projectId,taskId):api.observability.systemRuntimeTask(taskId),projectId,search.reportId,true,'native-pages/2',()=>go({...search,reportId:undefined},taskId));
 const report=query.error?undefined:query.data,data=report?runtimeCompleteReportContent(report):undefined,back=()=>go(search);
 return <Stack className={styles.page}><QueryStatus isPending={query.isPending} error={query.error}/>
  <RuntimeReportRecovery error={query.error} search={search} rebuild={()=>go({...search,reportId:undefined},taskId)}/>
  {report&&data?<><RuntimeReportState report={report}/><RuntimeItem<CompleteRuntimeTaskSummary> header={data.header} section="tasks" rowKey={taskId}>{task=><RuntimeTaskView task={task} header={data.header} back={back}/>}</RuntimeItem></>:<><PageHeader title={t('runtime.task')} actions={<Button size="small" variant="ghost" onClick={back}>{t('runtime.back')}</Button>}/>{report?<RuntimeReportState report={report}/>:null}</>}
 </Stack>;
}
const runtimeStates=['admitting','creating','pending','running','awaiting-input','verifying','cancelling','cancelled','succeeded','failed','pausing','paused','finalizing','closing','closed','unknown'];
const cohortKey=(search:RuntimeSearch)=>JSON.stringify([search.from,search.to,search.q,search.state,search.quality,search.sourceKind]);
function RuntimeOverviewPage({projectId,go}:PageProps) {
 const t=useT(),search=parseRuntimeSearch(useSearch({strict:false})),[initialNow]=useState(()=>Date.now()),[liveNow,setLiveNow]=useState(()=>Date.now()),[acceptedAggregate,setAcceptedAggregate]=useState<{scope:string;data:RuntimeAggregate}>();
 const window=runtimeWindow(search.reportId?{...search,period:'custom'}:search,liveNow),detailWindow=search.from&&search.to?{from:search.from,to:search.to,timezone:window.timezone}:runtimeWindow(search,initialNow),operations=search.tab==='resources'||search.tab==='health',current={...search,from:window.from,to:window.to};
 const filters={...window,q:search.q,state:search.state,quality:search.quality,sourceKind:search.sourceKind};
 const aggregate=useRuntimeAggregate(projectId,filters,!operations&&!search.reportId,()=>{if(search.period!=='custom'&&(search.period||!search.from))setLiveNow(Date.now());});
 const liveScope=JSON.stringify([projectId,search.period??(search.from?'custom':'day'),search.q,search.state,search.quality,search.sourceKind,search.period==='custom'||!search.period&&search.from?[search.from,search.to]:null]);
 if(!aggregate.error&&aggregate.data?.projection.bootstrapCompleted&&(acceptedAggregate?.scope!==liveScope||acceptedAggregate.data!==aggregate.data))setAcceptedAggregate({scope:liveScope,data:aggregate.data});
 const live=!aggregate.error&&acceptedAggregate?.scope===liveScope?acceptedAggregate.data:undefined,detailFilters={...filters,from:detailWindow.from,to:detailWindow.to};
 const query=useRuntimeReport(['statistics',projectId??'system',detailFilters],()=>projectId?api.observability.projectRuntimeStatistics(projectId,detailFilters):api.observability.systemRuntimeStatistics(detailFilters),projectId,search.reportId,!operations,'native-pages/2',()=>go({...current,reportId:undefined}));
 const report=operations||query.error?undefined:query.data,data=report?runtimeCompleteReportContent(report):undefined;
 const change=(next:RuntimeSearch)=>{const candidate={...current,...next};go({...candidate,reportId:cohortKey(candidate)===cohortKey(current)?candidate.reportId:undefined});};
 const returnSearch=data?{...current,...data.header.filters}:current,returnKey=runtimeReturnKey(projectId??'system',returnSearch);useRuntimeListReturn(returnKey,data!==undefined);
 const openTask=(id:string)=>{if(!data)return;rememberRuntimeList(returnKey,id);go({...returnSearch,reportId:data.header.reportId},id);};
 return <Stack className={styles.page} data-runtime-statistics>
  <PageHeader title={t(projectId?'runtime.projectTitle':'runtime.systemTitle')} description={t(operations?'runtime.operationsDescription':'runtime.description')} meta={data?t('runtime.snapshot',{at:runtimeDate(data.header.asOf,window.timezone),zone:window.timezone}):undefined} actions={!operations?<ActionRow><Button size="small" variant="ghost" onClick={()=>{if(search.period&&search.period!=='custom'){const now=Date.now();setLiveNow(now);go({...current,...runtimeWindow({...search,reportId:undefined},now),reportId:undefined});}else if(search.reportId)go({...current,reportId:undefined});else void query.refetch();}}>{t('runtime.refreshDetails')}</Button>{!projectId?<ButtonLink to="/admin/compute" search={{tab:'pricing'}}>{t('runtime.configurePricing')}</ButtonLink>:null}</ActionRow>:undefined}/>
  {!operations?<RuntimeFilters key={JSON.stringify([search.period,search.from,search.to])} window={window} search={search} change={change} states={runtimeStates}/>:null}
  {!operations&&live?.projection.asOf?<p className={styles.hint}>{t('runtime.liveSummary',{at:runtimeDate(live.projection.asOf,window.timezone)})}</p>:null}
  {!operations?<RuntimeSourceFilter search={search} change={change}/>:null}
  {!operations?<QueryStatus isPending={query.isPending&&!live} error={query.error}/>:null}
  {!operations?<RuntimeReportRecovery error={query.error} search={search} rebuild={()=>go({...current,reportId:undefined})}/>:null}
  <RuntimeViewTabs projectId={projectId} search={search} change={change}>{search.tab==='resources'?<RuntimeResourceMetrics window={window} projectId={projectId} search={search} change={change}/>:search.tab==='health'?<RuntimeHealth projectId={projectId} window={window}/>:data?<Stack>{report&&(search.tab??'overview')==='overview'?<RuntimeReportState report={report} compact/>:null}<RuntimeAnalysis key={data.header.reportId} summary={data.summary} header={data.header} search={search} change={change} task={openTask} liveSummary={live?.summary} liveFilters={live?.filters} occurrence={live?.occurrence}/></Stack>:live&&(search.tab??'overview')==='overview'?<Stack><RuntimeMetrics metrics={live.summary.metrics} tasks={live.summary.tasks} countLabel={t('runtime.objects')}/><RuntimeTrend summary={live.summary} header={{filters:window}} search={search} change={change}/></Stack>:report?<RuntimeReportState report={report}/>:null}</RuntimeViewTabs>
 </Stack>;
}
export function SystemRuntimeStatisticsPage() {
  const navigate = useNavigate(), { taskId } = useParams({ strict: false });
  const go = (search: RuntimeSearch, id?: string) => { if (id) void navigate({ to: '/admin/observability/tasks/$taskId', params: { taskId: id }, search, resetScroll: true }); else void navigate({ to: '/admin/observability', search, resetScroll: false }); };
  return taskId ? <RuntimeTaskPage taskId={taskId} go={go} /> : <RuntimeOverviewPage go={go} />;
}
export function ProjectRuntimeStatisticsPage() {
  const navigate = useNavigate(), { projectId, space } = useProjectScope(), { taskId } = useParams({ strict: false });
  const go = (search: RuntimeSearch, id?: string) => {
    if (id) void navigate({ to: space === 'admin' ? '/admin/integrations/$projectId/observability/tasks/$taskId' : '/projects/$projectId/observability/tasks/$taskId', params: { projectId, taskId: id }, search, resetScroll: true });
    else void navigate({ to: space === 'admin' ? '/admin/integrations/$projectId/observability' : '/projects/$projectId/observability', params: { projectId }, search, resetScroll: false });
  };
  return taskId ? <RuntimeTaskPage projectId={projectId} taskId={taskId} go={go} /> : <RuntimeOverviewPage projectId={projectId} go={go} />;
}
