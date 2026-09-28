import { useState } from 'react';
import type { RuntimeTaskObservation } from '@crewstation/contracts';
import { useT } from '../../../shared/lib/useT';
import { Stack } from '../../../shared/ui/Stack';
import { Card } from '../../../shared/ui/Card';
import { Button } from '../../../shared/ui/Button';
import { ActionRow } from '../../../shared/ui/ActionRow';
import { Dialog } from '../../../shared/ui/dialog/Dialog';
import { RuntimeMetrics, RuntimeTokenBuckets } from './RuntimeMetrics';
import { runtimeDate, runtimeDuration } from '../model/runtimeFormat';
import styles from './RuntimeStatistics.module.css';
export function RuntimeTimeline({ task }: { task: RuntimeTaskObservation }) {
  const t = useT(), [zoom, setZoom] = useState(false), [selectedId, setSelected] = useState<string>();
  const selected = task.attempts.find((attempt) => attempt.id === selectedId);
  const from = Math.min(Date.parse(task.createdAt), ...task.attempts.flatMap((a) => a.startedAt === null ? [] : [Date.parse(a.startedAt)]));
  const to = Math.max(from + 1, ...task.attempts.flatMap((a) => a.startedAt === null || a.durationMs === null ? [] : [Date.parse(a.startedAt) + a.durationMs]));
  return <>
    <Card title={t('runtime.timeline')} extra={<Button size="small" onClick={() => setZoom(!zoom)}>{t(zoom ? 'runtime.fit' : 'runtime.zoom')}</Button>} stacked>
      <p className={styles.hint}>{t('runtime.timelineHint')}</p>
      <div className={styles.scroll} tabIndex={0} role="region" aria-label={t('runtime.timeline')}>
        <div className={styles.timeline} style={{ minWidth: zoom ? 1200 : 680 }}>
          <div className={styles.lane}><strong>{t('runtime.attempt')}</strong><div className={styles.range}><span>{runtimeDate(new Date(from).toISOString())}</span><span>{runtimeDate(new Date(to).toISOString())}</span></div></div>
          {task.attempts.map((a) => <div className={styles.lane} key={a.id}>
            <div className={styles.laneLabel}>{a.name}<span className={styles.identity}>{t('runtime.attemptNumber', { count: a.attempt })} · {t('runtime.state.' + a.state)}</span></div>
            <div className={styles.track}>{a.startedAt !== null && a.durationMs !== null ? <button type="button" className={[styles.bar, a.state === 'failed' ? styles.failed : '', a.open ? styles.open : ''].join(' ')}
              style={{ left: `${(Date.parse(a.startedAt) - from) * 100 / (to - from)}%`, width: `${a.durationMs * 100 / (to - from)}%` }}
              aria-label={`${a.name} · ${t('runtime.attemptNumber', { count: a.attempt })} · ${runtimeDuration(a.durationMs)}`} title={`${runtimeDuration(a.durationMs)} · ${t('runtime.state.' + a.state)}`} onClick={() => setSelected(a.id)}>{runtimeDuration(a.durationMs)}</button>
              : <Button size="small" variant="ghost" onClick={() => setSelected(a.id)}>{t('runtime.timingUnknown')}</Button>}</div>
          </div>)}
        </div>
      </div>
      <ActionRow><span>{t('runtime.cumulative')}: {runtimeDuration(task.cumulativeMs)}</span><span>{t('runtime.union')}: {runtimeDuration(task.activeUnionMs)}</span><span>{t('runtime.missingIntervals', { count: task.unknownIntervals })}</span></ActionRow>
    </Card>
    {selected ? <Dialog title={selected.name + ' · ' + t('runtime.attemptNumber', { count: selected.attempt })} size="large" onClose={() => setSelected(undefined)}>
      <Stack><RuntimeMetrics metrics={selected.metrics} duration={selected.durationMs} /><RuntimeTokenBuckets metrics={selected.metrics} />
        <dl className={styles.facts}><dt>{t('runtime.start')}</dt><dd>{selected.startedAt ? runtimeDate(selected.startedAt) : '—'}</dd><dt>{t('runtime.end')}</dt><dd>{selected.endedAt ? runtimeDate(selected.endedAt) : t(selected.open ? 'runtime.runningUntil' : 'runtime.timingUnknown')}</dd><dt>{t('runtime.executionId')}</dt><dd>{selected.executionId ?? '—'}</dd></dl>
      </Stack>
    </Dialog> : null}
  </>;
}
