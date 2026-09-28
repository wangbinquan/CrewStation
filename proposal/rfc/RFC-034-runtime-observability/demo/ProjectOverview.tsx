import { useState } from 'react';
import { Card } from '../../../../apps/console/src/shared/ui/Card';
import { Stack } from '../../../../apps/console/src/shared/ui/Stack';
import { Button } from '../../../../apps/console/src/shared/ui/Button';
import { Dialog } from '../../../../apps/console/src/shared/ui/dialog/Dialog';
import type { Run } from './fixture';
import { agentGroups, duration, outcome, summarize, tokenLabel } from './aggregation';
import { MetricGrid, Notice, UsageBreakdown } from './Metrics';
import { RunTable } from './RunTable';
export function TokenTrend({ items, range, onRun }: { items: Run[]; range: number; onRun: (run: Run) => void }) {
  const [bucket, setBucket] = useState<number | null>(null);
  const count = range === 24 ? 8 : 7, width = range / count;
  const groups = Array.from({ length: count }, (_, i) => items.filter((r) => r.age >= (count - i - 1) * width && r.age < (count - i) * width));
  const values = groups.map((rs) => summarize(rs.flatMap((r) => r.attempts)).total), max = Math.max(1, ...values);
  return <><div className="barChart" role="group" aria-label="按运行开始时间分桶的已知 Token，选择区间查看任务">{groups.map((rs, i) => <button key={i} className="chartColumn" onClick={() => setBucket(i)} aria-label={`${(count-i)*width} 至 ${(count-i-1)*width} 小时前，${rs.length} 项运行，${rs.some((r) => r.attempts.length) ? tokenLabel(rs.flatMap((r) => r.attempts)) : '0'} Token`}><span className="chartValue">{rs.some((r) => r.attempts.length) ? tokenLabel(rs.flatMap((r) => r.attempts)) : '0'}</span><span className="chartTrack"><i style={{ height: `${Math.max(1, values[i] / max * 100)}%` }} /></span><small>{i === count - 1 ? '现在' : `-${(count-i-1)*width}h`}</small></button>)}</div><p className="muted small">演示按运行开始时间选取完整生命周期；正式消耗趋势按用量发生时间统计。</p>
    {bucket !== null && <Dialog title="时间区间内的运行" onClose={() => setBucket(null)} size="large"><RunTable items={groups[bucket]} onRun={(r) => { setBucket(null); onRun(r); }} /></Dialog>}
  </>;
}
export function ProjectOverview({ items, range, onRun, onTab }: { items: Run[]; range: number; onRun: (r: Run) => void; onTab: (tab: string) => void }) {
  const attempts = items.flatMap((r) => r.attempts), s = summarize(attempts), o = outcome(items), agents = agentGroups(items).slice(0, 5);
  const failure = items.find((r) => r.state === 'failed');
  return <Stack><MetricGrid items={[
    { title: '业务任务成功率', value: o.rate, hint: `${o.success}/${o.count} 个业务终态 · 取消与开发会话另计` },
    { title: '已知 Agent Token', value: tokenLabel(attempts), hint: `${s.complete}/${s.count} 次执行完整 · 含失败与重试` },
    { title: '业务完成 P95', value: o.p95 === null ? '—' : duration(o.p95), hint: `${o.count} 个样本 · 低样本演示`, warning: o.count > 0 },
    { title: '正在执行', value: items.filter((r) => r.state === 'running').length, hint: `${items.length} 项运行 · ${s.retries} 次技术重试` },
  ]} />
    {failure && <Notice warning><strong>需要关注：{failure.name}</strong><span>执行失败保留消耗，可从时间轴定位原因。</span><Button size="small" onClick={() => onRun(failure)}>查看失败执行</Button></Notice>}
    <div className="split"><Card title="Token 趋势" compact><TokenTrend items={items} range={range} onRun={onRun} /></Card><Card title="消耗构成" compact><UsageBreakdown attempts={attempts} /><div className="rankList">{agents.map((a) => <div key={a.key}><span>{a.name}</span><strong>{tokenLabel(a.attempts)}</strong></div>)}</div><Button size="small" onClick={() => onTab('agents')}>查看全部 Agent</Button></Card></div>
    <Card title="最近运行" compact extra={<Button size="small" onClick={() => onTab('runs')}>查看全部运行</Button>}><RunTable items={items.slice(0, 5)} onRun={onRun} /></Card>
  </Stack>;
}
