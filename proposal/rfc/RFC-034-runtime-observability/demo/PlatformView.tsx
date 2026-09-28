import { useState } from 'react';
import { Card } from '../../../../apps/console/src/shared/ui/Card';
import { Stack } from '../../../../apps/console/src/shared/ui/Stack';
import { Button } from '../../../../apps/console/src/shared/ui/Button';
import { DataTable } from '../../../../apps/console/src/shared/ui/DataTable';
import { Dialog } from '../../../../apps/console/src/shared/ui/dialog/Dialog';
import { Badge } from '../../../../apps/console/src/shared/ui/Badge';
import { MetricGrid, Notice } from './Metrics';
const capacity=[{name:'项目工作负载',request:9.5,actual:3.8,color:'business'},{name:'CrewStation 内置',request:4.5,actual:2.1,color:'platform'},{name:'其他工作负载',request:2,actual:1.4,color:'external'}];
const components=[
  {name:'cs-api',state:'健康',metric:'P95 185ms',hint:'请求、5xx、429 分开；不含长连接',source:'平台 HTTP 请求遥测'},
  {name:'cs-session',state:'健康',metric:'8 / 8 Runner 在线',hint:'重连、连接代次、持久水位与回放延迟',source:'会话持久事件与连接指标'},
  {name:'cs-controller',state:'关注',metric:'最旧待调和 6s',hint:'积压、失败与调和持续时间',source:'资源台账与调和 worker'},
  {name:'cs-events',state:'关注',metric:'2 次投递待重试',hint:'逻辑投递与投递尝试分别计数',source:'持久事件与投递状态机'},
  {name:'gateway',state:'健康',metric:'429 单列观察',hint:'按路由模板、服务和事件时角色关联',source:'网关采集合同（拟接入）'},
  {name:'PostgreSQL',state:'未采集',metric:'—',hint:'未启用连接池/查询观测，不能显示健康',source:'后续独立采集能力'},
];
export function PlatformView() {
  const [selected,setSelected]=useState<string|null>(null),component=components.find((c)=>c.name===selected);
  return <Stack><Notice>系统范围快照，不随项目或业务环境筛选。可观察全集群容量；管理动作仍仅面向 CrewStation 受管资源。</Notice><MetricGrid items={[{title:'CPU 可分配',value:'24 核',hint:'当前容量快照 · 不表示空闲量'},{title:'CPU 已申请',value:'16 核',hint:'项目 9.5 + 内置 4.5 + 其他 2'},{title:'CPU 实际',value:'7.3 核',hint:'按当前合成样本计量'},{title:'可调度余量',value:'8 核',hint:'24 − 16；还需满足内存与节点约束'}]}/>
    <div className="split"><Card compact title="申请与实际 · 同一容量标尺">{capacity.map((r)=><div key={r.name} className="capacityBlock"><div><strong>{r.name}</strong><span>实际 {r.actual} / 申请 {r.request} 核</span></div><div className="capacityTrack mutedTrack"><i style={{width:`${r.request/24*100}%`}}/></div><div className="capacityTrack"><i className={`resource-${r.color}`} style={{width:`${r.actual/24*100}%`}}/></div></div>)}</Card><Card compact title="内存与存储边界"><div className="statusGrid"><div><span>内存可分配</span><strong>64 GiB</strong></div><div><span>内存申请 / 实际</span><strong>42 / 27 GiB</strong></div><div><span>受管 PVC 申请</span><strong>320 GiB</strong></div><div><span>受管 PVC 已用</span><strong>148 GiB · 92% 覆盖</strong></div></div><p className="muted small">PVC 申请不等于物理磁盘已扩容；共享卷按 UID 去重。其他系统资源只观察，不提供管理动作。</p></Card></div>
    <Card compact title="平台组件与采集状态"><DataTable columns={['组件','状态','观测重点','操作']}>{components.map((c)=><tr key={c.name}><td><strong>{c.name}</strong><small>{c.hint}</small></td><td><Badge tone={c.state==='健康'?'success':c.state==='关注'?'warning':'neutral'}>{c.state}</Badge></td><td>{c.metric}</td><td><Button size="small" onClick={()=>setSelected(c.name)}>查看信号</Button></td></tr>)}</DataTable></Card>
    {component&&<Dialog title={`${component.name} · 平台信号`} onClose={()=>setSelected(null)}><Stack><p>{component.hint}</p><Card compact title="数据来源">{component.source}</Card><Notice warning={component.state==='未采集'}>{component.state==='未采集'?'当前没有采集数据，不能以零或绿色代替。':'这是合成信号。正式页面将关联同时间窗口的指标、日志与持久事件。'}</Notice></Stack></Dialog>}
  </Stack>;
}
