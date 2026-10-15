import type { ObservationCall } from '@crewstation/contracts';
import { useRef, useState } from 'react';
import { useDateText } from '../../../shared/lib/useDateText';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { DataTable } from '../../../shared/ui/DataTable';
import { TOKEN_BUCKETS, callCostText, callDurationMs, callTokenText, durationText } from '../model/runtimeFormat';
import { CallStatus, RuntimeCallDialog, callProfileText } from './RuntimeCallDetail';
import styles from './RuntimeStatistics.module.css';

/** 执行表：四类 Token 分列，输出含推理；「详情」打开该执行的按模型拆分。`withTask` 时首列为所属任务（平台执行列表）。 */
export function RuntimeCallTable({ calls, asOf, costVisible, withTask = false }: { calls: readonly ObservationCall[]; asOf: string; costVisible: boolean; withTask?: boolean }) {
  const t = useT(), dateText = useDateText('second'), [selected, setSelected] = useState<ObservationCall>(), opener = useRef<HTMLButtonElement | null>(null);
  const columns = [...(withTask ? [t('runtime.column.task')] : []), t('runtime.column.agent'), t('runtime.column.status'), t('runtime.column.start'),
    t('runtime.column.duration'), ...TOKEN_BUCKETS.map((bucket) => t('runtime.bucket.' + bucket)), t('runtime.column.cost'), t('runtime.column.actions')];
  return <>
    <DataTable className={styles.wideTable} columns={columns}>
      {calls.map((call) => <tr key={call.id} data-runtime-call-id={call.id}>
        {withTask ? <td>{call.taskLabel}<span className={styles.identity}>{t('runtime.kind.' + call.kind)}</span></td> : null}
        <td>{call.agentLabel}<span className={styles.identity}>{callProfileText(call, t)}{call.attempt === null ? '' : ` · ${t('runtime.attempt', { attempt: call.attempt })}`}</span></td>
        <td><CallStatus call={call} /></td>
        <td>{dateText(call.startedAt)}</td>
        <td>{durationText(callDurationMs(call, asOf))}</td>
        {TOKEN_BUCKETS.map((bucket) => <td key={bucket}>{callTokenText(call, call[bucket])}</td>)}
        <td>{callCostText(call, costVisible, t)}</td>
        <td><Button size="small" onClick={(event) => { opener.current = event.currentTarget; setSelected(call); }}>{t('runtime.details')}</Button></td>
      </tr>)}
    </DataTable>
    {selected ? <RuntimeCallDialog call={selected} asOf={asOf} costVisible={costVisible} returnFocusTo={opener} onClose={() => setSelected(undefined)} /> : null}
  </>;
}
