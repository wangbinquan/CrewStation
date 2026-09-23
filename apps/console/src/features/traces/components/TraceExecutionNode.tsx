import type { TraceExecutionDto } from '@crewstation/contracts';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { useDateText } from '../../../shared/lib/useDateText';
import { useT } from '../../../shared/lib/useT';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { CopyButton } from '../../../shared/ui/clipboard/CopyButton';
import { shortId, spanText, statusTone } from '../model/traceView';
import { TraceEvents } from './TraceEvents';
import styles from './Trace.module.css';

/** 一个 Agent 执行：类型与协议、档位、起止、原生会话 ID（可复制）、失败原因；有事件时可展开逐条看。 */
export function TraceExecutionNode({ projectId, traceId, execution }: { readonly projectId: string; readonly traceId: string; readonly execution: TraceExecutionDto }): ReactElement {
  const t = useT(), dateText = useDateText(), [open, setOpen] = useState(false);
  const label = `${t(`traces.execution.${execution.purpose}`)}${execution.protocol ? `（${execution.protocol}）` : ''}`;
  return <li className={styles.node}>
    <div className={styles.nodeLine}>
      <span className={styles.nodeTitle}>{label}</span>
      <Badge tone={statusTone(execution.status)}>{t(`traces.status.${execution.status}`)}</Badge>
    </div>
    <p className={styles.facts}>
      {execution.profileName ? <span className={styles.factPart}>{execution.profileName}</span> : null}
      <span className={styles.factPart}>{spanText(execution.startedAt, execution.endedAt, dateText, t)}</span>
    </p>
    {execution.sessionIds.map((id) => <div key={id} className={styles.nodeLine}>
      <span className={styles.facts} title={id}>{t('traces.execution.session', { id: shortId(id) })}</span><CopyButton value={id} />
    </div>)}
    {execution.failureReason ? <p className={styles.error}>{execution.failureReason}</p> : null}
    {execution.events > 0 ? <div>
      <Button size="small" variant={open ? 'ghost' : 'secondary'} aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? t('traces.execution.hideEvents') : t('traces.execution.showEvents', { count: execution.events })}
      </Button>
    </div> : null}
    {open ? <TraceEvents projectId={projectId} traceId={traceId} taskId={execution.taskId} label={label} /> : null}
  </li>;
}
