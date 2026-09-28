import { useEffect, useRef, useState } from 'react';
import { Brand } from '../../../../apps/console/src/shared/ui/Brand';
import { Button } from '../../../../apps/console/src/shared/ui/Button';
import { Card } from '../../../../apps/console/src/shared/ui/Card';
import { Stack } from '../../../../apps/console/src/shared/ui/Stack';
import { Badge } from '../../../../apps/console/src/shared/ui/Badge';
import { Tabs } from '../../../../apps/console/src/shared/ui/Tabs';
import { Segmented } from '../../../../apps/console/src/shared/ui/Segmented';
import { PageHeader } from '../../../../apps/console/src/shared/ui/PageHeader';
import { Dialog } from '../../../../apps/console/src/shared/ui/dialog/Dialog';
import { FormField } from '../../../../apps/console/src/shared/ui/FormField';
import { projects, runs, environmentLabels } from './fixture';
import type { Run } from './fixture';
import { filteredRuns } from './aggregation';
import { Selector, Notice } from './Metrics';
import { RunTable } from './RunTable';
import { ProjectOverview } from './ProjectOverview';
import { ExecutionView } from './ExecutionView';
import { AgentView } from './AgentView';
import { ServiceView } from './ServiceView';
import { QualityView } from './QualityView';
import { AdminOverview, CostView, ProjectComparison } from './AdminView';
import { PlatformView } from './PlatformView';
import { PricingView } from './PricingView';
interface View { page: string; scope: string; project: string; tab: string; range: string; environment: string; run: string; q: string; status: string; back: string; compareSort: string }
const projectTabs=[{value:'overview',label:'总览'},{value:'runs',label:'任务执行'},{value:'agents',label:'Agent 与 Token'},{value:'resources',label:'服务与资源'},{value:'quality',label:'异常与数据质量'}];
const adminTabs=[{value:'overview',label:'平台总览'},{value:'projects',label:'项目对比'},{value:'platform',label:'容量与平台'},{value:'costs',label:'Token 与成本'},{value:'quality',label:'异常与采集'}];
function readView(): View {
  const q=new URLSearchParams(location.search),scope=q.get('scope')==='admin'?'admin':'project';
  const tabs=scope==='admin'?adminTabs:projectTabs,p=q.get('project')??(scope==='admin'?'all':'code');
  return {page:scope==='admin'&&q.get('page')==='pricing'?'pricing':'observability',scope,project:(scope==='admin'&&p==='all')||projects.some((x)=>x.id===p)?p:'code',tab:tabs.some((x)=>x.value===q.get('tab'))?q.get('tab')!:'overview',range:q.get('range')==='168'?'168':'24',environment:Object.keys(environmentLabels).includes(q.get('env')??'')?q.get('env')!:'all',run:q.get('run')??'',q:q.get('q')??'',status:q.get('status')??'all',back:q.get('back')??'',compareSort:q.get('compareSort')==='failures'?'failures':'token'};
}
function urlOf(view:View) {
  const q=new URLSearchParams({page:view.page,scope:view.scope,project:view.project,tab:view.tab,range:view.range,env:view.environment});
  for(const key of ['run','q','back','status','compareSort'] as const) if(view[key]&&view[key]!=='all') q.set(key,view[key]); return `?${q}`;
}
function Sidebar({admin,projectName,page,onPage}:{admin:boolean;projectName:string;page:string;onPage:(page:string)=>void}) {
  const groups=admin?[['管理空间','总览','待处理事项'],['运行与观测','运行观测与统计','集群管理','业务运行','网关管理'],['业务与接入','项目管理','能力接入'],['配置','用户与权限','运行镜像','算力档位']]:[['当前项目',projectName],['构建与交付','项目概览','开发','发布与上线'],['运行','运行观测与统计','运行与诊断'],['配置','项目设置']];
  return <aside className="sidebar" aria-label={admin?'系统管理导航':'项目导航'}><div className="sidebarScope"><Badge tone={admin?'neutral':'info'}>{admin?'系统管理':'项目空间'}</Badge></div>{groups.map(([label,...items])=><div className="navGroup" key={label}><small>{label}</small>{items.map((item)=>{const selected=page==='pricing'?item==='算力档位':item==='运行观测与统计';return admin&&['算力档位','运行观测与统计'].includes(item)?<Button key={item} variant="ghost" className={selected?'navItem active':'navItem'} aria-current={selected?'page':undefined} onClick={()=>onPage(item==='算力档位'?'pricing':'observability')}>{item}</Button>:<div key={item} className={selected?'navItem active':'navItem'} aria-current={selected?'page':undefined}>{item}</div>;})}</div>)}<div className="sidebarFooter">RFC-034 · 设计原型<br/>算力档位可配置 Token 成本；其余项为位置示意</div></aside>;
}
function RunList({items,view,navigate,onRun}:{items:Run[];view:View;navigate:(next:Partial<View>)=>void;onRun:(r:Run)=>void}) {
  const visible=items.filter((r)=>(!view.q||`${r.id} ${r.name}`.toLowerCase().includes(view.q.toLowerCase()))&&(view.status==='all'||r.state===view.status));
  return <Stack><div className="listFilters"><FormField label="搜索任务"><input value={view.q} onChange={(e)=>navigate({q:e.target.value})} placeholder="名称或运行编号"/></FormField><Selector label="运行状态" value={view.status} options={[{value:'all',label:'全部状态'},{value:'done',label:'已完成'},{value:'failed',label:'失败'},{value:'running',label:'执行中'}]} onChange={(status)=>navigate({status})}/></div><Card compact title={`运行记录 · ${visible.length} 项`}><RunTable items={visible} onRun={onRun}/></Card></Stack>;
}
export function App() {
  const [view,setView]=useState(readView),[definition,setDefinition]=useState(false);const scroll=useRef(new Map<string,number>()),main=useRef<HTMLElement|null>(null);
  useEffect(()=>{const listener=()=>setView(readView());window.addEventListener('popstate',listener);return()=>window.removeEventListener('popstate',listener);},[]);
  useEffect(()=>{if(main.current){main.current.scrollTop=scroll.current.get(urlOf(view))??0;main.current.focus({preventScroll:true});}},[view.scope,view.page,view.tab,view.run,view.project]);
  const navigate=(next:Partial<View>)=>{scroll.current.set(urlOf(view),main.current?.scrollTop??0);const state={...view,...next};history.pushState({},'',urlOf(state));setView(state);};
  const admin=view.scope==='admin',pricingPage=admin&&view.page==='pricing',project=projects.find((p)=>p.id===view.project)??projects[0],range=Number(view.range);
  const items=filteredRuns({project:view.project,range,environment:view.environment}),selected=runs.find((r)=>r.id===view.run&&r.project===view.project);
  const comparison={sort:view.compareSort,onSort:(compareSort:string)=>navigate({compareSort})};
  const onTab=(tab:string)=>navigate({tab,run:''});
  const onRun=(r:Run)=>navigate({scope:'project',project:r.project,tab:'runs',run:r.id,back:admin?urlOf(view):view.back});
  const onProject=(id:string)=>navigate({scope:'project',project:id,tab:'overview',run:'',q:'',status:'all',back:urlOf(view)});
  const switchScope=(scope:string)=>navigate({page:'observability',scope,project:scope==='admin'?'all':view.project==='all'?'code':view.project,tab:'overview',run:'',q:'',status:'all',back:''});
  const goBack=()=>{if(!view.back.startsWith('?scope=admin'))return;history.pushState({},'',view.back);setView(readView());};
  return <div className="demoShell"><header className="topbar"><Brand/><div className="demoViewSwitch"><span className="muted small">演示视角</span><Segmented label="演示层级" value={view.scope} onChange={switchScope} items={[{value:'project',label:'项目层级'},{value:'admin',label:'系统管理'}]}/></div><Badge tone="warning">合成快照 · 09-28 16:00</Badge></header><Sidebar admin={admin} projectName={project.name} page={view.page} onPage={(page)=>navigate({scope:'admin',page,run:''})}/><main ref={main} className="demoMain" tabIndex={-1}><PricingView active={pricingPage} onBack={()=>navigate({page:'observability',tab:'costs'})}/>{!pricingPage&&<>
    <div className="breadcrumb">{admin?'系统管理 / 运行与观测':`${project.name} / 项目空间`} / 运行观测与统计{!admin&&view.back&&<Button size="small" onClick={goBack}>返回系统统计</Button>}</div>
    <PageHeader title="运行观测与统计" description={admin?'跨项目定位运行问题，理解平台容量、模型消耗与采集质量。':'看清本项目的任务执行、Agent 消耗、服务健康与资源使用。'} actions={<Button onClick={()=>setDefinition(true)}>指标口径</Button>}/>
    <div className="filterBar"><Selector label={admin?'项目范围':'当前项目'} value={view.project} options={[...(admin?[{value:'all',label:'全部项目'}]:[]),...projects.map((p)=>({value:p.id,label:p.name}))]} onChange={(project)=>navigate({project,run:'',q:''})}/><Selector label="统计范围" value={view.range} options={[{value:'24',label:'最近 24 小时'},{value:'168',label:'最近 7 天'}]} onChange={(range)=>navigate({range,run:''})}/><Selector label="环境" value={view.environment} options={Object.entries(environmentLabels).map(([value,label])=>({value,label}))} onChange={(environment)=>navigate({environment,run:''})}/><p className="filterHint">{admin?'仅管理员可见 · 全局与项目数据分区':'本项目可见范围 · 不含其他项目片段'}<br/>UTC+08:00 · 运行统计按开始时间选样本</p></div>
    <Tabs label={admin?'系统观测页签':'项目观测页签'} items={admin?adminTabs:projectTabs} value={view.tab} onChange={onTab}>
      {admin?<>{view.tab==='overview'&&<AdminOverview {...comparison} items={items} range={range} onProject={onProject} onRun={onRun} onTab={onTab}/ >}{view.tab==='projects'&&<ProjectComparison {...comparison} items={items} onProject={onProject}/ >}{view.tab==='platform'&&<PlatformView/>}{view.tab==='costs'&&<CostView {...comparison} items={items} allProjects={view.project==='all'} onProject={onProject} onPricing={()=>navigate({page:'pricing'})}/ >}{view.tab==='quality'&&<QualityView items={items} admin onRun={onRun}/>}</>:<>{view.tab==='overview'&&<ProjectOverview items={items} range={range} onRun={onRun} onTab={onTab}/ >}{view.tab==='runs'&&(selected?<ExecutionView key={selected.id} run={selected} onBack={()=>navigate({run:''})}/>:<RunList items={items} view={view} navigate={navigate} onRun={onRun}/ >)}{view.tab==='agents'&&<AgentView items={items} onRun={onRun}/ >}{view.tab==='resources'&&<ServiceView project={view.project} range={range} environment={view.environment}/ >}{view.tab==='quality'&&<QualityView items={items} admin={false} onRun={onRun}/ >}</>}
    </Tabs><footer className="pageFooter">设计原型 · 合成任务、资源样本与示例价格 · 未连接真实采集或权限服务</footer>
    {definition&&<Dialog title="统计口径与边界" onClose={()=>setDefinition(false)} size="large"><Stack><Notice>两层使用同一用量账本，权限和字段投影不同。此页是 Demo，并不执行真实角色切换。</Notice><ol className="definitionList"><li>项目任务含全部失败、重试和续聊消耗；父子视图不重复求和。</li><li>业务完成、Agent 累计执行、容器存活是三种时间。</li><li>“≥”表示已知下限，“—”表示未知；没有 Agent 时“不适用”。</li><li>系统成功率按全体业务终态计算，不平均项目百分比。</li><li>模型采购与定价仅管理层展示；项目使用公开档位。</li><li>全集群容量可观测；资源写操作仍去现有受管资源流程。</li><li>保留现有项目调用链边界与不发送告警通知的规则。</li></ol></Stack></Dialog>}
  </>}</main></div>;
}
