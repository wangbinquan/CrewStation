import { useState } from 'react';
import type { RuntimeTaskObservation, RuntimeNativeCapture } from '@crewstation/contracts';
import { useT } from '../../../shared/lib/useT';
import { Stack } from '../../../shared/ui/Stack';
import { Card } from '../../../shared/ui/Card';
import { Button } from '../../../shared/ui/Button';
import { ActionRow } from '../../../shared/ui/ActionRow';
import { FormField } from '../../../shared/ui/FormField';
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
        {selected.kind === 'agent' ? <NativeCaptureSummary key={selected.id} captures={selected.nativeCaptures ?? []} /> : null}
        <dl className={styles.facts}><dt>{t('runtime.start')}</dt><dd>{selected.startedAt ? runtimeDate(selected.startedAt) : '—'}</dd><dt>{t('runtime.end')}</dt><dd>{selected.endedAt ? runtimeDate(selected.endedAt) : t(selected.open ? 'runtime.runningUntil' : 'runtime.timingUnknown')}</dd><dt>{t('runtime.executionId')}</dt><dd>{selected.executionId ?? '—'}</dd></dl>
      </Stack>
    </Dialog> : null}
  </>;
}

function NativeCaptureSummary({ captures }: { captures: RuntimeNativeCapture[] }) {
  const t = useT(), [selectedId, select] = useState<string>();
  const ordered = [...captures].sort((a, b) => b.proof.turnIndex - a.proof.turnIndex || b.proof.observedAt.localeCompare(a.proof.observedAt));
  const selected = ordered.find((capture) => capture.id === selectedId) ?? ordered[0];
  return <Card title={t('runtime.native.title')} stacked>
    {!selected ? <p>{t('runtime.reason.native-capture-unobserved')}</p> : <Stack>
      <FormField label={t('runtime.native.turn')}><select value={selected.id} onChange={(event) => select(event.target.value)}>
        {ordered.map((capture) => <option key={capture.id} value={capture.id}>{t('runtime.native.turnNumber', { count: capture.proof.turnIndex + 1 })} · {runtimeDate(capture.proof.observedAt)} · {capture.sourceId.slice(-8)}</option>)}
      </select></FormField>
      <p><strong>{t('runtime.native.state.' + selected.state)}</strong> · {t('runtime.native.turns', { count: captures.length })}</p>
      <dl className={styles.facts}>
        <dt>{t('runtime.native.steps')}</dt><dd>{selected.receivedSteps} / {selected.proof.emitted}</dd>
        <dt>{t('runtime.native.baseline')}</dt><dd>{selected.receivedBaselineSteps} / {selected.proof.baselineSteps}</dd>
        <dt>{t('runtime.native.unresolved')}</dt><dd>{selected.unresolvedBaselineSteps}</dd>
        <dt>{t('runtime.native.revised')}</dt><dd>{selected.revisedBaselineSteps}</dd>
        <dt>{t('runtime.native.corrected')}</dt><dd>{selected.correctedBaselineSteps ?? 0}</dd>
        <dt>{t('runtime.native.root')}</dt><dd>{selected.proof.root ?? '—'}</dd>
        <dt>{t('runtime.native.observedAt')}</dt><dd>{runtimeDate(selected.proof.observedAt)}</dd>
      </dl>
      {selected.historicalRevisionGap ? <p>{t('runtime.native.historicalGap')}</p> : null}
      {selected.issues.length ? <ul>{[...new Set(selected.issues)].map((issue) => { const key = 'runtime.native.issue.' + issue, label = t(key); return <li key={issue} title={issue}>{label === key ? t('runtime.native.issue.other') : label}</li>; })}</ul> : null}
      <p className={styles.hint}>{t('runtime.native.hint')}</p>
    </Stack>}
  </Card>;
}
