import type { ReactNode } from 'react';
import { Card } from '../../../../apps/console/src/shared/ui/Card';
import { Badge } from '../../../../apps/console/src/shared/ui/Badge';
import { FormField } from '../../../../apps/console/src/shared/ui/FormField';
import { stateLabels } from './fixture';
import type { Attempt } from './fixture';
import { buckets, compact, summarize } from './aggregation';
export function MetricGrid({ items }: { items: { title: string; value: ReactNode; hint: string; warning?: boolean }[] }) {
  return <div className="metricGrid">{items.map((m) => <Card key={m.title} compact><div className="metricTitle">{m.title}</div><strong className={m.warning ? 'metricValue warningText' : 'metricValue'}>{m.value}</strong><div className="muted small">{m.hint}</div></Card>)}</div>;
}
export function Status({ state }: { state: keyof typeof stateLabels }) { return <Badge tone={state === 'done' ? 'success' : state === 'failed' ? 'danger' : 'info'}>{stateLabels[state]}</Badge>; }
export function Selector({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  return <FormField label={label}><select value={value} onChange={(e) => onChange(e.target.value)}>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></FormField>;
}
export function UsageBreakdown({ attempts }: { attempts: Attempt[] }) {
  const b = buckets(attempts), s = summarize(attempts);
  const labels = [['input', '非缓存输入'], ['read', '缓存读取'], ['write', '缓存写入'], ['output', '输出']] as const;
  return <div className="usageBreakdown"><div className="usageBar" aria-label="已知 Token 分项">{labels.map(([key, label]) => <span key={key} className={`usage-${key}`} style={{ width: `${s.total ? b[key] / s.total * 100 : 0}%` }} title={`${label}: ${b[key].toLocaleString()}`} />)}</div><div className="usageLegend">{labels.map(([key, label]) => <span key={key}><i className={`usage-${key}`} />{label}<strong>{s.known ? `${s.complete < s.count ? '≥ ' : ''}${compact(b[key])}` : '—'}</strong></span>)}</div><p className="muted small">{s.complete}/{s.count} 次执行完整；图中仅含已知用量。父任务与子 Agent 不重复累加。</p></div>;
}
export function Notice({ children, warning = false }: { children: ReactNode; warning?: boolean }) { return <div className={warning ? 'notice warning' : 'notice'}>{children}</div>; }
