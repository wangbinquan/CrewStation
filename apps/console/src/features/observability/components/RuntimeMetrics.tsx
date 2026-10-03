import type {CompleteRuntimeMetricsDto} from '@crewstation/contracts';
import {useT} from '../../../shared/lib/useT';
import {Card} from '../../../shared/ui/Card';
import {completeCny,completeTokens,completeDuration,completeCount} from '../model/completeFormat';
import {RUNTIME_TOKEN_BUCKETS} from '../model/runtimeFormat';
import styles from './RuntimeStatistics.module.css';
export function RuntimeMetrics({metrics,tasks,duration,countLabel}:{metrics:CompleteRuntimeMetricsDto;tasks?:string;duration?:string|null;countLabel?:string}) {
 const t=useT();return <div className={styles.grid} data-runtime-metrics>
  <Card title={t('runtime.tokens')}><RuntimeTokenMetric metrics={metrics} summary/><p className={styles.hint}>{metrics.state==='ready'?t('runtime.coverage',{observed:completeCount(metrics.observedExecutions),total:completeCount(metrics.executions)}):t('runtime.reason.not-applicable')}</p><p className={styles.hint}>{t('runtime.bucketHint')}</p></Card>
  <Card title={t('runtime.cost')}><p className={styles.value} title={metrics.state==='ready'?metrics.cost.amount??undefined:undefined}>{completeCny(metrics,t)}</p><p className={styles.hint}>{t('runtime.cnyHint')}</p></Card>
  <Card title={countLabel??t(tasks===undefined?'runtime.executions':'runtime.tasks')}><p className={styles.value}>{tasks!==undefined?completeCount(tasks):metrics.state==='ready'?completeCount(metrics.executions):'—'}</p><p className={styles.hint}>{t('runtime.completePopulation')}</p></Card>
  {duration!==undefined?<Card title={t('runtime.wall')}><p className={styles.value}>{completeDuration(duration)}</p><p className={styles.hint}>{t('runtime.wallHint')}</p></Card>:null}
 </div>;
}
export function RuntimeTokenBuckets({metrics}:{metrics:CompleteRuntimeMetricsDto}) {
 const t=useT();return <dl className={styles.tokenBuckets} data-token-buckets aria-label={t('runtime.buckets')}>{RUNTIME_TOKEN_BUCKETS.map(bucket=><div key={bucket} data-token-bucket={bucket}><dt>{t('runtime.'+bucket)}</dt><dd>{completeTokens(metrics,bucket)}</dd></div>)}</dl>;
}
export function RuntimeTokenMetric({metrics,summary=false}:{metrics:CompleteRuntimeMetricsDto;summary?:boolean}) {return <div className={styles.tokenMetric}><strong className={summary?styles.value:undefined}>{completeTokens(metrics)}</strong><RuntimeTokenBuckets metrics={metrics}/></div>;}
