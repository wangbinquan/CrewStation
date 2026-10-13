import {RuntimeStorageSchema} from '@crewstation/contracts';
import {api} from '../../../../shared/api/client';
import {useApiQuery} from '../../../../shared/api/useApi';
import {useT} from '../../../../shared/lib/useT';
import {Card} from '../../../../shared/ui/Card';
import {DefinitionList} from '../../../../shared/ui/DefinitionList';
import {QueryStatus} from '../../../../shared/ui/QueryStatus';
import {runtimeDate} from '../../model/runtimeFormat';
export function RuntimeStorage(){
 const t=useT(),query=useApiQuery(['runtime-storage'],async()=>RuntimeStorageSchema.parse(await api.observability.runtimeStorage()),{refetchIntervalMs:30000}),data=query.error?undefined:query.data,bytes=(n:string|null)=>n===null?t('runtime.storageUnknown'):`${Number(BigInt(n)*100n/1048576n)/100} MiB`;
 return <Card title={t('runtime.storageTitle')} stacked footer={t('runtime.storagePolicy')}><QueryStatus isPending={query.isPending} error={query.error}/>{data?<><DefinitionList layout="grid" items={[
 {label:t('runtime.storageDatabase'),value:bytes(data.databaseBytes)},
 {label:t('runtime.storageFacts'),value:bytes(data.factsBytes)},
 {label:t('runtime.storageDerived'),value:bytes(data.derivedBytes)},
 {label:t('runtime.storageIndexes'),value:bytes(data.indexBytes)},
 {label:t('runtime.storageReusable'),value:bytes(data.reusableBytes)},
 {label:t('runtime.storageFree'),value:bytes(data.freeBytes)},
 {label:t('runtime.storageGrowth'),value:bytes(data.growthBytesPerDay)},
 {label:t('runtime.storageDays'),value:data.daysRemaining??t('runtime.storageUnknown')},
 {label:t('runtime.storageQueue'),value:data.pending+' · '+runtimeDate(data.oldestPendingAt)},
 {label:t('runtime.storageReports'),value:data.activeReports+' / '+data.retiringReports},
 {label:t('runtime.storageReclaimed'),value:data.reclaimed+' · '+runtimeDate(data.lastSuccess)},
 {label:t('runtime.storageSampled'),value:runtimeDate(data.sampledAt)},
 ]}/>{data.lastError?<p role="status">{t('runtime.storageRetry')}: {data.lastError}</p>:null}{data.daysRemaining!==null&&data.daysRemaining<7?<p role="status">{t('runtime.storagePressure')}</p>:null}</>:null}</Card>;
}
