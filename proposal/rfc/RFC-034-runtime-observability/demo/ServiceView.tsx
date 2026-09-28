import { useState } from 'react';
import { Card } from '../../../../apps/console/src/shared/ui/Card';
import { Stack } from '../../../../apps/console/src/shared/ui/Stack';
import { Button } from '../../../../apps/console/src/shared/ui/Button';
import { DataTable } from '../../../../apps/console/src/shared/ui/DataTable';
import { Dialog } from '../../../../apps/console/src/shared/ui/dialog/Dialog';
import { TimeSeries } from '../../../../apps/console/src/shared/ui/TimeSeries';
import { DefinitionList } from '../../../../apps/console/src/shared/ui/DefinitionList';
import { Badge } from '../../../../apps/console/src/shared/ui/Badge';
import { snapshot } from './fixture';
import { compact, serviceSeries } from './aggregation';
import { MetricGrid, Notice } from './Metrics';
export function ServiceView({project,range,environment}:{project:string;range:number;environment:string}) {
  const values=serviceSeries(project,range,environment),[selected,setSelected]=useState<string|null>(null),total=values.reduce((s,p)=>s+p.requests,0),errors=values.reduce((s,p)=>s+p.errors,0);
  const points=values.map((v,i)=>({at:new Date(new Date(snapshot).getTime()-(values.length-1-i)*range/values.length*3600e3).toISOString(),average:v.cpu,peak:v.cpu*1.3,coverage:1,complete:true}));
  const current=values.at(-1)!,requests=environment==='development'?2:4;
  return <Stack><Notice>服务请求与基础设施按所选时间、环境展示，独立于业务任务生命周期。以下为合成采样，不代表已接入网关指标。</Notice><MetricGrid items={[{title:'服务请求',value:compact(total),hint:'按完成请求计数，SSE / WS 另计'},{title:'HTTP 5xx',value:`${(errors/total*100).toFixed(2)}%`,hint:`${errors}/${total} · 与任务失败率分开`},{title:'CPU 实际',value:`${current.cpu.toFixed(2)} 核`,hint:`申请 ${requests} 核 · 当前示例样本`},{title:'资源采集覆盖',value:'100%',hint:'所选窗口的合成资源样本'}]}/>
    <div className="split"><Card compact title="CPU 实际使用趋势"><TimeSeries title="平均 / 峰值 · 核" points={points} format={(v)=>v.toFixed(2)} labels={{average:'平均',peak:'峰值',coverage:'覆盖率',select:'查看时间点',gap:'采集缺口'}}/></Card><Card compact title="实际、申请和限制"><div className="capacityBlock"><div><span>实际</span><strong>{current.cpu.toFixed(2)} 核</strong></div><div className="capacityTrack"><i style={{width:`${current.cpu/8*100}%`}}/></div><div><span>申请</span><strong>{requests} 核</strong></div><div className="capacityTrack mutedTrack"><i style={{width:`${requests/8*100}%`}}/></div><div><span>限制</span><strong>8 核</strong></div></div><p className="muted small">申请量用于调度，限制不是已消耗。项目并发额度与 CPU 资源是不同口径。</p></Card></div>
    <Card compact title="服务与存储定位 · 对象示意"><DataTable columns={['对象','角色 / 用途','状态','关键观测','操作']}>
      {[['service','应用服务','正式 / 待验证','按版本查看请求与延迟'],['volume','共享工作卷','父任务与 Agent 共用','申请 20 GiB · 实际 3.2 GiB'],['quota','项目执行额度','业务 / 开发分别准入','2 / 6 占用，含尚未清理完成对象']].map(([id,name,role,hint])=><tr key={id}><td>{name}</td><td>{role}</td><td><Badge tone="success">示例可观测</Badge></td><td>{hint}</td><td><Button size="small" onClick={()=>setSelected(id)}>查看关联</Button></td></tr>)}
    </DataTable></Card>{selected&&<Dialog title={selected==='volume'?'共享工作卷归属':selected==='quota'?'额度口径与准入':'服务与发布关联'} onClose={()=>setSelected(null)}><Stack><DefinitionList items={selected==='volume'?[{label:'资源身份',value:'同一 PVC UID，仅计量一次'},{label:'挂载关系',value:'父任务容器 + Agent 独立 Pod'},{label:'生命周期',value:'执行完成不等于卷释放'}]:selected==='quota'?[{label:'额度占用',value:'由资源台账状态推导'},{label:'与实际 CPU 的关系',value:'两项独立指标，不能互相替代'}]:[{label:'历史角色',value:'按请求发生时的物理槽与角色归属'},{label:'发布关联',value:'保留 releaseId 与切流注记'},{label:'既有诊断',value:'生产实现链接到同项目日志、健康与形态图'}]}/><Notice>这是设计关联说明；原型不连接真实集群，也不提供资源写操作。</Notice></Stack></Dialog>}
  </Stack>;
}
