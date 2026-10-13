import {useState} from 'react';
import {PlatformUsagePageSchema,type RuntimeStatisticsQuery,type PlatformUsageMetrics} from '@crewstation/contracts';
import {api} from '../../../shared/api/client';
import {AUTO_REFRESH,useApiQuery} from '../../../shared/api/useApi';
import {useT} from '../../../shared/lib/useT';
import {Card} from '../../../shared/ui/Card';
import {DataTable} from '../../../shared/ui/DataTable';
import {Button} from '../../../shared/ui/Button';
import {QueryStatus} from '../../../shared/ui/QueryStatus';
import {EmptyState} from '../../../shared/ui/EmptyState';
import {completeCount} from '../model/completeFormat';
import {runtimeDate} from '../model/runtimeFormat';
import styles from './RuntimeStatistics.module.css';
function Usage({data}:{data:PlatformUsageMetrics}){const t=useT();return <div><strong>{completeCount(data.tokens.total)}</strong>{!data.tokenComplete?<span className={styles.identity}>{t('runtime.receivedValue')}</span>:null}<dl className={styles.tokenBuckets}>{(['input','cacheRead','cacheWrite','output'] as const).map(b=><div key={b}><dt>{t('runtime.'+b)}</dt><dd>{data.tokens[b]===null?'—':completeCount(data.tokens[b])}</dd></div>)}</dl></div>;}
export function RuntimePlatformUsage(props:{window:RuntimeStatisticsQuery}){return <PlatformUsage key={JSON.stringify(props.window)} {...props}/>;}
function PlatformUsage({window}:{window:RuntimeStatisticsQuery}){
 const t=useT(),[after,setAfter]=useState<string|undefined>(),query=useApiQuery(['runtime-platform-usage',window,after],async()=>PlatformUsagePageSchema.parse(await api.observability.platformUsage(window,after)),AUTO_REFRESH),data=query.error?undefined:query.data;
 return <Card title={t('runtime.platformUsage')} stacked footer={t('runtime.platformUsageHint')}><QueryStatus isPending={query.isPending} error={query.error}/>{data?<><div className={styles.grid}><Usage data={data.summary}/><div><strong>{data.summary.amount===null?'—':'¥'+data.summary.amount}</strong><p className={styles.hint}>{t(data.summary.priceComplete?'runtime.platformPriceComplete':'runtime.platformPricePartial')}</p></div></div>{data.items.length?<DataTable columns={[t('runtime.compute'),t('runtime.start'),t('runtime.tokens'),t('runtime.cost')]}>{data.items.map(row=><tr key={row.admission.testId}><td>{row.profileName??t('runtime.platformProfileUnknown')}<span className={styles.identity}>{row.admission.protocol} · r{row.admission.profileRevision}</span></td><td>{runtimeDate(row.admission.acceptedAt)}</td><td><Usage data={row.metrics}/></td><td>{row.metrics.amount===null?'—':'¥'+row.metrics.amount}<span className={styles.identity}>{t(row.metrics.priceComplete?'runtime.platformPriceComplete':'runtime.platformPricePartial')}</span></td></tr>)}</DataTable>:<EmptyState title={t('runtime.platformUsageEmpty')}/>}<p className={styles.hint}>{t('runtime.platformUsageAsOf',{at:runtimeDate(data.asOf)})}</p>{after?<Button size="small" variant="ghost" onClick={()=>setAfter(undefined)}>{t('runtime.firstResources')}</Button>:null}{data.nextCursor?<Button size="small" variant="secondary" onClick={()=>setAfter(data.nextCursor!)}>{t('runtime.nextResources')}</Button>:null}</>:null}</Card>;
}
