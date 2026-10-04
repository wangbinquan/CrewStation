import {useState} from 'react';
import type {RuntimeCompleteSummary,RuntimeReportHeader,CompleteRuntimeMetricsDto} from '@crewstation/contracts';
import {useT} from '../../../shared/lib/useT';
import {Card} from '../../../shared/ui/Card';
import {RuntimeTokenMetric} from './RuntimeMetrics';
import {runtimeDate,RUNTIME_TOKEN_BUCKETS} from '../model/runtimeFormat';
import {completeCount,completeTokens,completeTokenValues,completePercent} from '../model/completeFormat';
import type {RuntimeSearch} from '../model/runtimeSearch';
import styles from './RuntimeStatistics.module.css';
export function RuntimeTrend({summary,header,search,change}:{summary:RuntimeCompleteSummary;header:RuntimeReportHeader;search:RuntimeSearch;change:(next:RuntimeSearch)=>void}) {
 const t=useT(),[activeFrom,setActiveFrom]=useState<string|null>(null),max=summary.trend.reduce((value,row)=>{const total=BigInt(completeTokenValues(row.metrics)?.total??'0');return total>value?total:value;},1n);
 const active=summary.trend.find(row=>row.from===activeFrom)??summary.trend.find(row=>BigInt(row.tasks)>0n)??summary.trend[0];
 const buckets=(metrics:CompleteRuntimeMetricsDto)=>RUNTIME_TOKEN_BUCKETS.map(bucket=>`${t('runtime.'+bucket)} ${completeTokens(metrics,bucket)}`).join(' · ');
 return <Card title={t('runtime.trend')} footer={t('runtime.trendHint')} stacked>
  <div className={styles.tokenLegend} aria-label={t('runtime.buckets')}>{RUNTIME_TOKEN_BUCKETS.map(bucket=><span key={bucket}><i data-token-color={bucket} aria-hidden="true"/>{t('runtime.'+bucket)}</span>)}</div>
  <div className={styles.scroll}><div className={styles.chart} role="group" aria-label={t('runtime.trend')}>{summary.trend.map(row=><button key={row.from} type="button" className={styles.chartColumn} aria-label={`${runtimeDate(row.from,header.filters.timezone)} · ${completeTokens(row.metrics)} Token · ${completeCount(row.tasks)} ${t('runtime.objects')} · ${buckets(row.metrics)}`} title={`${runtimeDate(row.from,header.filters.timezone)} — ${runtimeDate(row.to,header.filters.timezone)} · ${buckets(row.metrics)}`} onFocus={()=>setActiveFrom(row.from)} onMouseEnter={()=>setActiveFrom(row.from)} onClick={()=>change({...search,reportId:undefined,from:row.from,to:row.to,tab:'tasks'})}>
   <span className={styles.chartValue} aria-hidden="true">{completeTokens(row.metrics)}</span><span className={styles.chartTrack} aria-hidden="true">{BigInt(completeTokenValues(row.metrics)?.total??'0')>0n?<span className={styles.chartBar} data-positive="true" data-partial={row.metrics.state==='not-ready'} style={{height:`${completePercent(completeTokenValues(row.metrics)!.total,String(max))}%`}}>{RUNTIME_TOKEN_BUCKETS.map(bucket=><span key={bucket} className={styles.chartSegment} data-token-bucket={bucket} data-token-color={bucket} style={{height:`${completePercent(completeTokenValues(row.metrics)?.[bucket]??'0',completeTokenValues(row.metrics)?.total??'0')}%`}}/>)}</span>:null}</span>
  </button>)}</div></div><div className={styles.range}><span>{runtimeDate(header.filters.from,header.filters.timezone)}</span><span>{runtimeDate(header.filters.to,header.filters.timezone)}</span></div>
  {active?<div className={styles.trendDetail} role="group" aria-label={t('runtime.trendInterval')}><span className={styles.hint}>{runtimeDate(active.from,header.filters.timezone)} — {runtimeDate(active.to,header.filters.timezone)} · {completeCount(active.tasks)} {t('runtime.objects')}</span><RuntimeTokenMetric metrics={active.metrics}/></div>:null}
 </Card>;
}
