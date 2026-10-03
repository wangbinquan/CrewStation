import type {RefObject} from 'react';
import type {RuntimeReportHeader,CompleteRuntimeAgent,CompleteRuntimeProfile,CompleteRuntimeProject,CompleteRuntimeModel,CompleteRuntimeContribution} from '@crewstation/contracts';
import {useT} from '../../../shared/lib/useT';
import {Stack} from '../../../shared/ui/Stack';
import {Card} from '../../../shared/ui/Card';
import {Button} from '../../../shared/ui/Button';
import {DataTable} from '../../../shared/ui/DataTable';
import {Dialog} from '../../../shared/ui/dialog/Dialog';
import {RuntimeRows,RuntimeItem} from './RuntimeRows';
import {RuntimeMetrics,RuntimeTokenMetric,RuntimeTokenBuckets} from './RuntimeMetrics';
import {runtimeAgentName,runtimeComputeLabel,runtimeSourceLabel} from '../model/runtimeFormat';
import {completeCount,completeCny} from '../model/completeFormat';
import type {RuntimeSearch} from '../model/runtimeSearch';
import styles from './RuntimeStatistics.module.css';
interface Props {header:RuntimeReportHeader;search:RuntimeSearch;change:(next:RuntimeSearch)=>void;task:(id:string)=>void;opener?:RefObject<HTMLButtonElement|null>}
export function RuntimeProjects({header,search,change}:Omit<Props,'task'>) {
 const t=useT();return <Card title={t('runtime.projects')}><RuntimeRows<CompleteRuntimeProject> header={header} section="projects">{rows=><DataTable columns={['project','objects','tokens','cost'].map(key=>t('runtime.'+key))}>{rows.map(row=><tr key={row.projectId}><td><Button size="small" variant="ghost" onClick={()=>change({...search,reportId:undefined,tab:'usage',q:row.projectId})}>{row.projectName??t('runtime.nameUnavailable')}</Button><span className={styles.identity}>{row.projectId}</span></td><td>{completeCount(row.tasks)}</td><td><RuntimeTokenMetric metrics={row.metrics}/></td><td>{completeCny(row.metrics,t)}</td></tr>)}</DataTable>}</RuntimeRows></Card>;
}
export function RuntimeAgents({header,search,change,opener}:Omit<Props,'task'>) {
 const t=useT();return <Card title={t('runtime.agents')} footer={t('runtime.agentHint')}><RuntimeRows<CompleteRuntimeAgent> header={header} section="agents">{rows=><DataTable columns={['runtime.agent','runtime.objects','runtime.executions','runtime.tokens','runtime.cost'].map(key=>t(key))}>{rows.map(row=><tr key={row.key}><td><Button ref={node=>{if(node&&row.key===search.agent&&opener)opener.current=node;}} size="small" variant="ghost" onClick={()=>change({...search,agent:row.key,profile:undefined})}>{runtimeAgentName(row,t)}</Button><span className={styles.identity}>{runtimeSourceLabel(row.sourceKind,t)}</span><span className={styles.identity}>{runtimeComputeLabel(row,t)}</span></td><td>{completeCount(row.tasks)}</td><td>{row.metrics.state==='ready'?completeCount(row.metrics.executions):'—'}</td><td><RuntimeTokenMetric metrics={row.metrics}/></td><td>{completeCny(row.metrics,t)}</td></tr>)}</DataTable>}</RuntimeRows></Card>;
}
export function RuntimeUsage({header,summary,search,change,opener}:Omit<Props,'task'>&{summary:Parameters<typeof RuntimeTokenBuckets>[0]['metrics']}) {
 const t=useT();return <Stack><Card title={t('runtime.buckets')}><RuntimeTokenBuckets metrics={summary}/></Card>
  <Card title={t('runtime.profiles')} footer={t('runtime.profileHint')}><RuntimeRows<CompleteRuntimeProfile> header={header} section="profiles">{rows=><DataTable columns={['profile','objects','tokens','cost'].map(key=>t('runtime.'+key))}>{rows.map(row=><tr key={row.key}><td><Button ref={node=>{if(node&&row.key===search.profile&&opener)opener.current=node;}} size="small" variant="ghost" onClick={()=>change({...search,profile:row.key,agent:undefined})}>{runtimeComputeLabel(row,t)}</Button><span className={styles.identity}>{row.profileId??t('runtime.unknown')}</span></td><td>{completeCount(row.tasks)}</td><td><RuntimeTokenMetric metrics={row.metrics}/></td><td>{completeCny(row.metrics,t)}</td></tr>)}</DataTable>}</RuntimeRows></Card>
  {header.scope==='system'?<Card title={t('runtime.models')} footer={t('runtime.modelHint')}><RuntimeRows<CompleteRuntimeModel> header={header} section="models">{rows=><DataTable columns={['runtime.model','runtime.objects','runtime.tokens','runtime.cost'].map(key=>t(key))}>{rows.map(row=><tr key={row.modelRef??'unknown'}><td>{row.modelRef??t('runtime.unknown')}</td><td>{completeCount(row.tasks)}</td><td><RuntimeTokenMetric metrics={row.metrics}/></td><td>{completeCny(row.metrics,t)}</td></tr>)}</DataTable>}</RuntimeRows></Card>:null}
  <Card title={t('runtime.pricingSource')}><p>{t(header.scope==='system'?'runtime.systemPricing':'runtime.projectPricing')}</p></Card>
 </Stack>;
}
function Contributions({header,section,parent,task}:{header:RuntimeReportHeader;section:'agent-tasks'|'profile-tasks';parent:string;task:(id:string)=>void;opener?:RefObject<HTMLButtonElement|null>}) {
 const t=useT();return <RuntimeRows<CompleteRuntimeContribution> header={header} section={section} parent={parent}>{rows=><DataTable columns={['task','project','attempts','tokens','cost'].map(key=>t('runtime.'+key))}>{rows.map(row=><tr key={row.taskId} data-runtime-task-id={row.taskId}><td><Button size="small" variant="ghost" onClick={()=>task(row.taskId)}>{row.taskName}</Button><span className={styles.identity}>{runtimeSourceLabel(row.sourceKind,t)}</span></td><td>{row.projectName??t('runtime.nameUnavailable')}</td><td>{completeCount(row.attempts)}</td><td><RuntimeTokenMetric metrics={row.metrics}/></td><td>{completeCny(row.metrics,t)}</td></tr>)}</DataTable>}</RuntimeRows>;
}
export function RuntimeDimensionDetail({header,search,change,task,opener}:Props) {
 const t=useT(),selected=search.agent??search.profile;if(!selected)return null;
 const section=search.agent?'agents':'profiles';return <Dialog returnFocusTo={opener} title={t(search.agent?'runtime.agents':'runtime.profiles')} size="large" onClose={()=>change({...search,agent:undefined,profile:undefined})}><Stack>
  <RuntimeItem<CompleteRuntimeProfile|CompleteRuntimeAgent> header={header} section={section} rowKey={selected}>{row=><>{'name' in row?<p>{runtimeAgentName(row,t)}</p>:null}<p>{runtimeComputeLabel(row,t)}</p><RuntimeMetrics metrics={row.metrics} tasks={row.tasks}/></>}</RuntimeItem>
  <Contributions header={header} section={search.agent?'agent-tasks':'profile-tasks'} parent={selected} task={task}/>
 </Stack></Dialog>;
}
