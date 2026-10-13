import type {CompleteRuntimeMetricsDto} from '@crewstation/contracts';
import {useT} from '../../../shared/lib/useT';
import {Card} from '../../../shared/ui/Card';
import {Disclosure} from '../../../shared/ui/Disclosure';
import {completeCny,completeTokens,completeDuration,completeCount} from '../model/completeFormat';
import {RUNTIME_TOKEN_BUCKETS} from '../model/runtimeFormat';
import styles from './RuntimeStatistics.module.css';
export function RuntimeMetrics({metrics,tasks,duration,countLabel}:{metrics:CompleteRuntimeMetricsDto;tasks?:string;duration?:string|null;countLabel?:string}) {
 const t=useT(),pricing='costCoverage' in metrics?metrics.costCoverage:undefined;return <div className={styles.grid} data-runtime-metrics>
  <Card title={t('runtime.tokens')}><RuntimeTokenMetric metrics={metrics} summary/></Card>
  <Card title={t('runtime.cost')}><p className={styles.value} title={metrics.state==='ready'?metrics.cost.amount??undefined:undefined}>{completeCny(metrics,t)}</p><Disclosure label={t('runtime.priceDetails')}><p>{t('runtime.cnyHint')}</p>{pricing?<p className={styles.hint}>{t(pricing.partiallyPricedRecords&&pricing.partiallyPricedRecords!=='0'?'runtime.partialPricingCoverage':'runtime.pricingCoverage',{priced:completeCount(pricing.pricedRecords),partial:completeCount(pricing.partiallyPricedRecords??'0'),records:completeCount(pricing.records)})}</p>:null}</Disclosure></Card>
  <Card title={countLabel??t(tasks===undefined?'runtime.executions':'runtime.tasks')}><p className={styles.value}>{tasks!==undefined?completeCount(tasks):metrics.state==='ready'?completeCount(metrics.executions):'—'}</p><p className={styles.hint}>{t('runtime.completePopulation')}</p></Card>
  {duration!==undefined?<Card title={t('runtime.wall')}><p className={styles.value}>{completeDuration(duration)}</p><p className={styles.hint}>{t('runtime.wallHint')}</p></Card>:null}
 </div>;
}
export function RuntimeTokenBuckets({metrics}:{metrics:CompleteRuntimeMetricsDto}) {
 const t=useT();return <dl className={styles.tokenBuckets} data-token-buckets aria-label={t('runtime.buckets')}>{RUNTIME_TOKEN_BUCKETS.map(bucket=><div key={bucket} data-token-bucket={bucket}><dt>{t('runtime.'+bucket)}</dt><dd>{completeTokens(metrics,bucket)}</dd></div>)}</dl>;
}
export function RuntimeTokenMetric({metrics,summary=false}:{metrics:CompleteRuntimeMetricsDto;summary?:boolean}) {
 const t=useT(),usage=metrics.state==='ready'?metrics:metrics.state==='not-ready'?metrics.recordedUsage:undefined;
 return <div className={styles.tokenMetric}><strong className={summary?styles.value:undefined}>{completeTokens(metrics)}</strong>{metrics.state!=='ready'||summary?<Disclosure className={styles.metricNotes} label={t(metrics.state==='not-ready'?'runtime.receivedValue':'runtime.collectionDetails')}>
  {usage?<><p>{t('runtime.records')}: {completeCount(usage.records)}</p>{usage.executions!=='0'?<p>{t('runtime.coverage',{observed:completeCount(usage.observedExecutions),total:completeCount(usage.executions)})}</p>:null}</>:null}
  {metrics.state==='not-ready'?<p>{metrics.gaps.map(reason=>{const key='runtime.reason.'+reason,label=t(key);return label===key?reason:label;}).join(' · ')||t('runtime.report.usageGap')}</p>:null}
  {metrics.state==='not-applicable'?<p>{t('runtime.reason.not-applicable')}</p>:null}
  {summary?<p>{t('runtime.bucketHint')}</p>:null}
 </Disclosure>:null}<RuntimeTokenBuckets metrics={metrics}/></div>;
}

export function RuntimeCostMetric({metrics}:{metrics:CompleteRuntimeMetricsDto}){const t=useT();return <strong>{completeCny(metrics,t)}</strong>;}
