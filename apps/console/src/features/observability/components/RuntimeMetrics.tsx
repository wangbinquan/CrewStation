import type {CompleteRuntimeMetricsDto} from '@crewstation/contracts';
import {useT} from '../../../shared/lib/useT';
import {Card} from '../../../shared/ui/Card';
import {completeCny,completeTokens,completeDuration,completeCount} from '../model/completeFormat';
import {RUNTIME_TOKEN_BUCKETS} from '../model/runtimeFormat';
import styles from './RuntimeStatistics.module.css';
export function RuntimeMetrics({metrics,tasks,duration,countLabel}:{metrics:CompleteRuntimeMetricsDto;tasks?:string;duration?:string|null;countLabel?:string}) {
 const t=useT(),usage=metrics.state==='ready'?metrics:metrics.state==='not-ready'?metrics.recordedUsage:undefined,pricing='costCoverage' in metrics?metrics.costCoverage:undefined;return <div className={styles.grid} data-runtime-metrics>
  <Card title={t('runtime.tokens')}><RuntimeTokenMetric metrics={metrics} summary/><p className={styles.hint}>{usage?t('runtime.coverage',{observed:completeCount(usage.observedExecutions),total:completeCount(usage.executions)}):t(metrics.state==='not-ready'?'runtime.report.usageGap':'runtime.reason.not-applicable')}</p><p className={styles.hint}>{t('runtime.bucketHint')}</p></Card>
  <Card title={t('runtime.cost')}><p className={styles.value} title={metrics.state==='ready'?metrics.cost.amount??undefined:undefined}>{completeCny(metrics,t)}</p><p className={styles.hint}>{t('runtime.cnyHint')}</p>{pricing?<p className={styles.hint}>{t('runtime.pricingCoverage',{priced:completeCount(pricing.pricedRecords),records:completeCount(pricing.records)})}</p>:null}</Card>
  <Card title={countLabel??t(tasks===undefined?'runtime.executions':'runtime.tasks')}><p className={styles.value}>{tasks!==undefined?completeCount(tasks):metrics.state==='ready'?completeCount(metrics.executions):'—'}</p><p className={styles.hint}>{t('runtime.completePopulation')}</p></Card>
  {duration!==undefined?<Card title={t('runtime.wall')}><p className={styles.value}>{completeDuration(duration)}</p><p className={styles.hint}>{t('runtime.wallHint')}</p></Card>:null}
 </div>;
}
export function RuntimeTokenBuckets({metrics}:{metrics:CompleteRuntimeMetricsDto}) {
 const t=useT();return <dl className={styles.tokenBuckets} data-token-buckets aria-label={t('runtime.buckets')}>{RUNTIME_TOKEN_BUCKETS.map(bucket=><div key={bucket} data-token-bucket={bucket}><dt>{t('runtime.'+bucket)}</dt><dd>{completeTokens(metrics,bucket)}</dd></div>)}</dl>;
}
export function RuntimeTokenMetric({metrics,summary=false}:{metrics:CompleteRuntimeMetricsDto;summary?:boolean}) {const t=useT();return <div className={styles.tokenMetric}><strong className={summary?styles.value:undefined}>{completeTokens(metrics)}</strong>{metrics.state==='not-ready'&&metrics.recordedUsage?<span className={styles.identity}>{t('runtime.receivedValue')}</span>:null}<RuntimeTokenBuckets metrics={metrics}/></div>;}
