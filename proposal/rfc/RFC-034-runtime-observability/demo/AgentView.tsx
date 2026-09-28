import { useState } from 'react';
import { Card } from '../../../../apps/console/src/shared/ui/Card';
import { Stack } from '../../../../apps/console/src/shared/ui/Stack';
import { Button } from '../../../../apps/console/src/shared/ui/Button';
import { Dialog } from '../../../../apps/console/src/shared/ui/dialog/Dialog';
import { DataTable } from '../../../../apps/console/src/shared/ui/DataTable';
import { EmptyState } from '../../../../apps/console/src/shared/ui/EmptyState';
import type { Run } from './fixture';
import { agentGroups, duration, summarize, tokenLabel } from './aggregation';
import { MetricGrid, Notice, UsageBreakdown } from './Metrics';
export function AgentView({items,onRun}:{items:Run[];onRun:(run:Run)=>void}) {
  const groups=agentGroups(items),[selected,setSelected]=useState<string|null>(null),agent=groups.find((g)=>g.key===selected),attempts=items.flatMap((r)=>r.attempts);
  return <Stack><Notice>项目按应用内 Agent 身份与公开档位归因。费用与内部模型采购信息由系统管理员查看；同名 Agent 不跨项目合并。</Notice><div className="split"><Card compact title="已知 Token 分项"><UsageBreakdown attempts={attempts}/></Card><Card compact title="统计口径"><p>全部执行尝试保留用量，包括失败、取消、重试和续聊。运行中的用量是下限；通用 CLI 可能不支持计量。</p><p className="muted small">输入与缓存四桶互斥；模型推理 Token 若为输出子集，不重复相加。</p></Card></div>
    <Card title="Agent 跨任务汇总" compact>{groups.length?<DataTable columns={['Agent','任务 / 执行','Token','累计执行','完整性','操作']}>{groups.map((g)=>{const s=summarize(g.attempts);return <tr key={g.key}><td><strong>{g.name}</strong><small>{[...new Set(g.attempts.map((a)=>a.profile))].join(' / ')}</small></td><td>{g.runs.length} / {s.count}</td><td>{tokenLabel(g.attempts)}</td><td>{duration(s.seconds)}</td><td>{s.complete}/{s.count}</td><td><Button size="small" onClick={()=>setSelected(g.key)}>查看贡献</Button></td></tr>;})}</DataTable>:<EmptyState title="本范围没有 Agent 执行" description="接入项目和纯命令运行的 Token 指标不适用。"/>}</Card>
    {agent&&<Dialog title={`${agent.name} · 跨任务贡献`} onClose={()=>setSelected(null)} size="large"><Stack><MetricGrid items={[{title:'已知 Token',value:tokenLabel(agent.attempts),hint:`${agent.runs.length} 项任务`},{title:'累计执行',value:duration(summarize(agent.attempts).seconds),hint:`${agent.attempts.length} 次执行`} ]}/><DataTable columns={['任务','Token','执行次数','累计执行','操作']}>{agent.runs.map((r)=>{const a=r.attempts.filter((x)=>x.agent===agent.name);return <tr key={r.id}><td>{r.name}<small>{r.id}</small></td><td>{tokenLabel(a)}</td><td>{a.length}</td><td>{duration(summarize(a).seconds)}</td><td><Button size="small" onClick={()=>{setSelected(null);onRun(r);}}>打开任务</Button></td></tr>;})}</DataTable><UsageBreakdown attempts={agent.attempts}/></Stack></Dialog>}
  </Stack>;
}
