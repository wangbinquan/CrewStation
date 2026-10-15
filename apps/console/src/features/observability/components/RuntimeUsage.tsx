import type { ObservationUsage } from '@crewstation/contracts';
import { useT } from '../../../shared/lib/useT';
import { Badge } from '../../../shared/ui/Badge';
import { TOKEN_BUCKETS, countText, tokenText, tokenTotal, usageCostText } from '../model/runtimeFormat';
import type { TokenBuckets } from '../model/runtimeFormat';
import styles from './RuntimeStatistics.module.css';

/** 四桶互斥，推理是输出的子集，单列展示不另计入合计。 */
export function TokenBucketList({ usage, lowerBound }: { usage: TokenBuckets & { readonly reasoning: number }; lowerBound: boolean }) {
  const t = useT();
  return <dl className={styles.tokenBuckets} data-token-buckets="">
    {TOKEN_BUCKETS.map((bucket) => <div key={bucket}><dt>{t('runtime.bucket.' + bucket)}</dt><dd>{tokenText(usage[bucket], lowerBound)}</dd></div>)}
    <div><dt>{t('runtime.bucket.reasoning')}</dt><dd>{tokenText(usage.reasoning, lowerBound)}</dd></div>
  </dl>;
}

/** 汇总是否完整：用量不完整的执行让合计成为下界；未定价的执行不计入人民币。费用不可见时不提定价。 */
export function UsageNotes({ usage }: { usage: ObservationUsage }) {
  const t = useT();
  const unpriced = usage.costNano !== null && usage.unpricedCalls > 0;
  if (!usage.incompleteCalls && !unpriced && !usage.failedCalls) return null;
  return <span className={styles.notes}>
    {usage.incompleteCalls ? <Badge tone="warning">{t('runtime.incompleteCalls', { count: countText(usage.incompleteCalls) })}</Badge> : null}
    {unpriced ? <Badge tone="neutral">{t('runtime.unpricedCalls', { count: countText(usage.unpricedCalls) })}</Badge> : null}
    {usage.failedCalls ? <Badge tone="danger">{t('runtime.failedCalls', { count: countText(usage.failedCalls) })}</Badge> : null}
  </span>;
}

/** 表格里的一格 Token：合计在上，四桶在下。 */
export function UsageTokens({ usage }: { usage: ObservationUsage }) {
  const lowerBound = usage.incompleteCalls > 0;
  return <div className={styles.tokenMetric}><strong>{tokenText(tokenTotal(usage), lowerBound)}</strong><TokenBucketList usage={usage} lowerBound={lowerBound} /></div>;
}

export function UsageCost({ usage }: { usage: ObservationUsage }) {
  const t = useT();
  return <span className={styles.amount}>{usageCostText(usage, t)}</span>;
}
