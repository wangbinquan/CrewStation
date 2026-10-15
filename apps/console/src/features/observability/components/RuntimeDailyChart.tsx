import type { ObservationOverview } from '@crewstation/contracts';
import { useState } from 'react';
import { useT } from '../../../shared/lib/useT';
import { Card } from '../../../shared/ui/Card';
import { TOKEN_BUCKETS, compactCount, countText, tokenText, tokenTotal, usageCostText } from '../model/runtimeFormat';
import styles from './RuntimeStatistics.module.css';

type Day = ObservationOverview['daily'][number];

/** 按天堆叠四桶；点一天看当天的拆分。日桶按浏览器时区切，窗口内每天都有一列（没有执行的天为 0）。 */
export function RuntimeDailyChart({ daily, costVisible }: { daily: readonly Day[]; costVisible: boolean }) {
  const t = useT(), [selected, setSelected] = useState<string>();
  const max = Math.max(1, ...daily.map(tokenTotal));
  const active = daily.find((row) => row.day === selected) ?? [...daily].reverse().find((row) => row.calls > 0) ?? daily.at(-1);
  return <Card title={t('runtime.daily')} footer={t('runtime.dailyHint')} stacked>
    <div className={styles.tokenLegend} aria-label={t('runtime.buckets')}>
      {TOKEN_BUCKETS.map((bucket) => <span key={bucket}><i data-token-color={bucket} aria-hidden="true" />{t('runtime.bucket.' + bucket)}</span>)}
    </div>
    <div className={styles.scroll}><div className={styles.chart} role="group" aria-label={t('runtime.daily')}>
      {daily.map((row) => <DayColumn key={row.day} row={row} max={max} active={row.day === active?.day} select={() => setSelected(row.day)} />)}
    </div></div>
    {active ? <div className={styles.trendDetail} data-runtime-day={active.day}>
      {/* 与总览卡同一口径：有不完整的执行时是下界，只有未定价的执行时写「未定价」而不是 ¥0（未知不是 0）。 */}
      <p className={styles.hint}>{active.day} · {t('runtime.callCount', { count: countText(active.calls) })}{costVisible && active.costNano !== null ? ` · ${usageCostText(active, t)}` : ''}</p>
      <dl className={styles.tokenBuckets}>{TOKEN_BUCKETS.map((bucket) => <div key={bucket}><dt>{t('runtime.bucket.' + bucket)}</dt><dd>{tokenText(active[bucket], active.incompleteCalls > 0)}</dd></div>)}</dl>
    </div> : null}
  </Card>;
}

function DayColumn({ row, max, active, select }: { row: Day; max: number; active: boolean; select: () => void }) {
  const t = useT(), total = tokenTotal(row);
  const label = `${row.day} · ${tokenText(total, row.incompleteCalls > 0)} Token · ${t('runtime.callCount', { count: countText(row.calls) })}`;
  return <button type="button" className={styles.chartColumn} aria-pressed={active} aria-label={label} title={label} onClick={select}>
    <span className={styles.chartValue} aria-hidden="true">{compactCount(total)}</span>
    <span className={styles.chartTrack} aria-hidden="true">
      {total > 0 ? <span className={styles.chartBar} data-positive="true" style={{ height: `${(total / max) * 100}%` }}>
        {TOKEN_BUCKETS.map((bucket) => row[bucket] > 0
          ? <span key={bucket} className={styles.chartSegment} data-token-color={bucket} style={{ height: `${(row[bucket] / total) * 100}%` }} />
          : null)}
      </span> : null}
    </span>
    <span className={styles.chartLabel}>{row.day.slice(5)}</span>
  </button>;
}
