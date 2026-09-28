import { useState } from 'react';
import { Card } from '../../../../apps/console/src/shared/ui/Card';
import { Stack } from '../../../../apps/console/src/shared/ui/Stack';
import { Button } from '../../../../apps/console/src/shared/ui/Button';
import { DataTable } from '../../../../apps/console/src/shared/ui/DataTable';
import { Badge } from '../../../../apps/console/src/shared/ui/Badge';
import { Dialog } from '../../../../apps/console/src/shared/ui/dialog/Dialog';
import { DefinitionList } from '../../../../apps/console/src/shared/ui/DefinitionList';
import { EmptyState } from '../../../../apps/console/src/shared/ui/EmptyState';
import { projects, prices, platformExecutions } from './fixture';
import type { Run } from './fixture';
import { duration, money, outcome, summarize, tokenLabel } from './aggregation';
import { MetricGrid, Notice, Selector, UsageBreakdown } from './Metrics';
import { TokenTrend } from './ProjectOverview';
interface ComparisonProps { items:Run[]; onProject:(id:string)=>void; sort:string; onSort:(value:string)=>void }
export function ProjectComparison({items,onProject,sort,onSort}:ComparisonProps) {
  const groups=projects.map((p)=>({project:p,runs:items.filter((r)=>r.project===p.id)})).filter((p)=>p.runs.length);
  groups.sort((a,b)=>sort==='token'?summarize(b.runs.flatMap((r)=>r.attempts)).total-summarize(a.runs.flatMap((r)=>r.attempts)).total:b.runs.filter((r)=>r.state==='failed').length-a.runs.filter((r)=>r.state==='failed').length);
  return <Card compact title="项目对比" extra={<Selector label="排序" value={sort} options={[{value:'token',label:'已知 Token 从高到低'},{value:'failures',label:'失败运行从多到少'}]} onChange={onSort}/>}>
    {groups.length?<DataTable columns={['项目','业务成功 / 终态','已知 Token','完成 P95','执行完整性','异常运行','操作']} className="comparisonTable">{groups.map(({project:p,runs:rs})=>{const attempts=rs.flatMap((r)=>r.attempts),s=summarize(attempts),o=outcome(rs),issues=rs.filter((r)=>r.state==='failed'||r.attempts.some((a)=>!a.complete)).length;return <tr key={p.id}><td><strong>{p.name}</strong><small>{p.kind} · {rs.length} 项运行</small></td><td>{o.rate}<small>{o.success}/{o.count} 个业务终态</small></td><td>{tokenLabel(attempts)}</td><td>{o.p95===null?'—':duration(o.p95)}<small>低样本</small></td><td>{s.count?`${s.complete}/${s.count}`:'不适用'}</td><td><Badge tone={issues?'warning':'success'}>{issues?`${issues} 项需关注`:'当前无异常'}</Badge></td><td><Button size="small" onClick={()=>onProject(p.id)}>进入项目</Button></td></tr>;})}</DataTable>:<EmptyState title="当前范围没有项目运行"/>}
  </Card>;
}
export function AdminOverview({items,range,onProject,onRun,onTab,sort,onSort}:ComparisonProps & {range:number;onRun:(r:Run)=>void;onTab:(id:string)=>void}) {
  const attempts=items.flatMap((r)=>r.attempts),s=summarize(attempts),o=outcome(items),issues=items.filter((r)=>r.state==='failed'||r.attempts.some((a)=>!a.complete));
  return <Stack><MetricGrid items={[{title:'有活动的项目',value:new Set(items.map((r)=>r.project)).size,hint:`${items.length} 项运行 · 业务 / 开发分开统计`},{title:'业务成功率',value:o.rate,hint:`${o.success}/${o.count} 个业务终态 · 不平均项目成功率`},{title:'项目已知 Token',value:tokenLabel(attempts),hint:`${s.complete}/${s.count} 次执行完整`},{title:'需关注运行',value:issues.length,hint:'执行失败、待完成用量与不支持计量',warning:issues.length>0}]}/>
    <div className="split"><Card compact title="跨项目用量趋势"><TokenTrend items={items} range={range} onRun={onRun}/></Card><Card compact title="平台运行快照" extra={<Badge tone="info">合成快照</Badge>}><div className="statusGrid">{[['API','健康'],['Runner 接入','8 / 8 在线'],['资源调和','水位落后 6s'],['事件投递','2 次待重试']].map(([a,b])=><div key={a}><span>{a}</span><strong>{b}</strong></div>)}</div><p className="muted small">平台组件快照独立于项目与环境筛选；采集不支持时显示未知。</p><Button size="small" onClick={()=>onTab('platform')}>查看容量与平台</Button></Card></div>
    <ProjectComparison items={items} onProject={onProject} sort={sort} onSort={onSort}/><Notice>系统全局口径 = 项目直接归属 + 平台专用 + 共享未分配；项目排行不重复分摊平台开销。</Notice>
  </Stack>;
}
export function CostView({items,allProjects,onProject,sort,onSort,onPricing}:ComparisonProps & {allProjects:boolean;onPricing:()=>void}) {
  const [pricing,setPricing]=useState(false),attempts=items.flatMap((r)=>r.attempts),system=allProjects?platformExecutions:[],all=[...attempts,...system];
  const s=summarize(all),models=[...Object.entries(prices).map(([id,p])=>({id,...p,attempts:all.filter((a)=>a.model===id)})),{id:'unknown',label:'未知模型 / 不支持计量',attempts:all.filter((a)=>a.model==='unknown')}].filter((m)=>m.attempts.length);
  return <Stack><Notice warning>费用统一展示人民币（CNY）。当前按人工填写的人民币示例单价估算，未接入真实账单。</Notice><MetricGrid items={[{title:'已知模型费用 · 人民币',value:money(all),hint:'含当前项目范围及平台专用执行（全项目时）'},{title:'项目直接归属',value:money(attempts),hint:'每个 usage contribution 仅归属一次'},{title:'平台专用',value:allProjects?money(system):'范围外',hint:'档位 / 镜像验证不混入业务任务'},{title:'完整计量执行',value:`${s.complete}/${s.count}`,hint:'未知或未定价不表示免费'}]}/>
    <div className="split"><Card compact title="Token 构成"><UsageBreakdown attempts={all}/></Card><Card compact title="单价配置与费用边界"><Stack><p><strong>配置入口：系统管理 → 算力档位 → Token 成本</strong></p><p className="muted small">按档位绑定的运行时、模型配置，单位：元 / 百万 Token。更新生成新版本，历史费用保留原价。</p><Button onClick={onPricing}>配置 Token 单价</Button><p>基础设施尚未配置价格，因此不与模型费用强行相加。共享控制面开销单列，未启用项目分摊。</p><p className="muted small">如后续启用分摊，需记录成本池、分摊基数、规则版本与生效区间。</p><Button size="small" onClick={()=>setPricing(true)}>查看示例价格版本</Button></Stack></Card></div>
    <Card compact title="模型与档位归因 · 仅管理员"><DataTable columns={['内部模型','已知 Token','估算费用（人民币）','完整计量']}>{models.map((m)=><tr key={m.id}><td>{m.label}</td><td>{tokenLabel(m.attempts)}</td><td>{money(m.attempts)}</td><td>{summarize(m.attempts).complete}/{m.attempts.length}</td></tr>)}</DataTable></Card><ProjectComparison items={items} onProject={onProject} sort={sort} onSort={onSort}/>
    {pricing&&<Dialog title="人民币价格版本 · CNY-v1" onClose={()=>setPricing(false)} size="large"><Stack><DefinitionList items={[{label:'来源',value:'人工合成，仅供设计演示'},{label:'币种与单位',value:'人民币 CNY · 元 / 百万 Token'},{label:'有效时间',value:'2026-09-01 起；执行受理时绑定版本，历史不随新价格改变'}]}/><DataTable columns={['模型','非缓存输入（元）','缓存读（元）','缓存写（元）','输出（元）']}>{Object.entries(prices).map(([id,p])=><tr key={id}><td>{p.label}</td><td>{p.input}</td><td>{p.read}</td><td>{p.write}</td><td>{p.output}</td></tr>)}</DataTable></Stack></Dialog>}
  </Stack>;
}
