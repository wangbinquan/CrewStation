import type { ObservationCall } from '@crewstation/contracts';
import { useRef, useState } from 'react';
import { useDateText } from '../../../shared/lib/useDateText';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { callDurationMs, durationText } from '../model/runtimeFormat';
import { RuntimeCallDialog, callProfileText } from './RuntimeCallDetail';
import styles from './RuntimeStatistics.module.css';

interface Lane { readonly key: string; readonly label: string; readonly calls: readonly ObservationCall[] }

/** 按 Agent 分行，同一 Agent 的多次尝试排在一行；行顺序按首次开始。 */
export function callLanes(calls: readonly ObservationCall[]): Lane[] {
  const lanes = new Map<string, ObservationCall[]>();
  for (const call of [...calls].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))) lanes.set(call.agentKey, [...(lanes.get(call.agentKey) ?? []), call]);
  return [...lanes].map(([key, rows]) => ({ key, label: rows.at(-1)!.agentLabel, calls: rows }));
}

/** 任务的执行泳道：横轴为任务内首个执行开始到最后结束（运行中的执行延伸到读取时刻）。 */
export function RuntimeCallLanes({ calls, asOf, costVisible }: { calls: readonly ObservationCall[]; asOf: string; costVisible: boolean }) {
  const t = useT(), dateText = useDateText('second'), [selected, setSelected] = useState<ObservationCall>(), [zoom, setZoom] = useState(false);
  const opener = useRef<HTMLButtonElement | null>(null), lanes = callLanes(calls);
  const from = Math.min(...calls.map((call) => Date.parse(call.startedAt))), to = Math.max(...calls.map((call) => Date.parse(call.endedAt ?? asOf)));
  const span = Math.max(1, to - from);
  return <Card title={t('runtime.lanes')} footer={t('runtime.lanesHint')} extra={<Button size="small" variant="ghost" onClick={() => setZoom(!zoom)}>{t(zoom ? 'runtime.fit' : 'runtime.zoom')}</Button>} stacked>
    <div className={styles.scroll} tabIndex={0} role="region" aria-label={t('runtime.lanes')}>
      <div className={styles.timeline} data-runtime-lanes="" style={{ minWidth: zoom ? 1200 : 680 }}>
        <div className={styles.lane}><strong>{t('runtime.column.agent')}</strong><div className={styles.range}><span>{dateText(new Date(from).toISOString())}</span><span>{dateText(new Date(to).toISOString())}</span></div></div>
        {lanes.map((lane) => <div key={lane.key} className={styles.lane}>
          <div className={styles.laneLabel}>{lane.label}<span className={styles.identity}>{callProfileText(lane.calls.at(-1)!, t)}</span></div>
          <div className={styles.track}>{lane.calls.map((call) => {
            const left = ((Date.parse(call.startedAt) - from) / span) * 100, width = Math.max(0.5, (callDurationMs(call, asOf) / span) * 100);
            const label = `${call.agentLabel}${call.attempt === null ? '' : ` · ${t('runtime.attempt', { attempt: call.attempt })}`} · ${t('runtime.status.' + call.status)} · ${durationText(callDurationMs(call, asOf))}`;
            return <button key={call.id} type="button" aria-label={label} title={label} style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}
              className={[styles.bar, call.status === 'failed' || call.status === 'interrupted' ? styles.failed : '', call.status === 'running' ? styles.open : ''].filter(Boolean).join(' ')}
              onClick={(event) => { opener.current = event.currentTarget; setSelected(call); }}>
              {call.attempt === null ? t('runtime.status.' + call.status) : `#${call.attempt}`}
            </button>;
          })}</div>
        </div>)}
      </div>
    </div>
    {selected ? <RuntimeCallDialog call={selected} asOf={asOf} costVisible={costVisible} returnFocusTo={opener} onClose={() => setSelected(undefined)} /> : null}
  </Card>;
}
