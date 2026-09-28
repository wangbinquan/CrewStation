import { Button } from '../../../../apps/console/src/shared/ui/Button';
import { DataTable } from '../../../../apps/console/src/shared/ui/DataTable';
import { EmptyState } from '../../../../apps/console/src/shared/ui/EmptyState';
import { environmentLabels, kindLabels } from './fixture';
import type { Run } from './fixture';
import { duration, summarize, tokenLabel } from './aggregation';
import { Status } from './Metrics';
export function RunTable({ items, onRun }: { items: Run[]; onRun: (run: Run) => void }) {
  if (!items.length) return <EmptyState title="没有符合条件的运行" description="调整时间、环境或搜索条件；空结果不表示采集失败。" />;
  return <DataTable columns={['任务 / 执行', '环境 / 来源', '状态', 'Token', '任务历时', '执行 / 完整', '操作']} className="runTable">
    {items.map((r) => { const s = summarize(r.attempts); return <tr key={r.id}><td><strong>{r.name}</strong><small>{r.id} · {r.release}</small></td><td>{environmentLabels[r.environment]}<small>{kindLabels[r.kind]}</small></td><td><Status state={r.state} /></td><td className="numeric">{tokenLabel(r.attempts)}</td><td className="numeric">{duration(r.wall)}</td><td>{s.count} / {s.complete}<small>{s.retries ? `${s.retries} 次技术重试` : r.attempts.some((a) => a.kind === 'turn') ? '含续聊回合' : r.attempts.length ? '首次执行' : '无 Agent'}</small></td><td><Button size="small" onClick={() => onRun(r)}>查看执行</Button></td></tr>; })}
  </DataTable>;
}
