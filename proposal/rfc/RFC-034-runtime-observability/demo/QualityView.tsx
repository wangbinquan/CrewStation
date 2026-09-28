import { Card } from '../../../../apps/console/src/shared/ui/Card';
import { Stack } from '../../../../apps/console/src/shared/ui/Stack';
import { Button } from '../../../../apps/console/src/shared/ui/Button';
import { DataTable } from '../../../../apps/console/src/shared/ui/DataTable';
import { Badge } from '../../../../apps/console/src/shared/ui/Badge';
import { EmptyState } from '../../../../apps/console/src/shared/ui/EmptyState';
import type { Run } from './fixture';
import { summarize } from './aggregation';
import { MetricGrid, Notice } from './Metrics';
export function QualityView({items,admin,onRun}:{items:Run[];admin:boolean;onRun:(r:Run)=>void}) {
  const s=summarize(items.flatMap((r)=>r.attempts)),issues=items.filter((r)=>r.state==='failed'||r.attempts.some((a)=>!a.complete));
  return <Stack><MetricGrid items={[{title:'用量完整执行',value:`${s.complete}/${s.count}`,hint:'明确区分未上报、进行中和不支持'},{title:'已知用量执行',value:`${s.known}/${s.count}`,hint:'有部分数据也不等于完整'},{title:'需关注的运行',value:issues.length,hint:'执行失败或用量尚未完整'}]}/><Notice>沿用现有告警记录能力。本设计不发送通知、不自动停止任务、不调整集群资源。</Notice>
    <Card compact title="异常定位">{issues.length?<DataTable columns={['运行','异常类型','解释','操作']}>{issues.map((r)=><tr key={r.id}><td>{r.name}<small>{r.id}</small></td><td><Badge tone={r.state==='failed'?'danger':'warning'}>{r.state==='failed'?'执行失败':r.state==='running'?'用量待完成':'计量不支持'}</Badge></td><td>{r.state==='failed'?'失败消耗保留，查看执行片段':r.state==='running'?'快照下限，最终用量尚未到齐':'通用 CLI 没有可信 Token 数据'}</td><td><Button size="small" onClick={()=>onRun(r)}>定位执行</Button></td></tr>)}</DataTable>:<EmptyState title="当前样本没有待定位异常" description="仅表示当前范围的结果，不代表所有采集源都健康。"/>}</Card>
    <Card compact title={admin?'平台采集能力与边界':'本项目采集能力与边界'}><DataTable columns={['数据源','当前设计能力','新鲜度 / 边界']}><tr><td>业务执行事件</td><td>持久 cursor、attempt 与 usage</td><td>重复 / 乱序 / gap 需要账本对账</td></tr><tr><td>开发 CLI</td><td>执行活动可观测；Token 按协议分级</td><td>不根据终端文本猜用量</td></tr><tr><td>资源实际用量</td><td>复用 RFC-015</td><td>现有最近 7 天；未知不补零</td></tr><tr><td>日志</td><td>当前有界 Pod 尾部</td><td>不能承诺完整历史</td></tr><tr><td>网关 RED / 长连接</td><td>本 RFC 后续接入</td><td>Demo 为合成指标</td></tr></DataTable></Card>
  </Stack>;
}
