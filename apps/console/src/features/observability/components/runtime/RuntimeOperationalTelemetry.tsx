import {useState} from 'react';
import {ChoiceField} from '../../../../shared/ui/selection/ChoiceField';
import {OperationalTelemetrySchema,type OperationalTelemetryQuery} from '@crewstation/contracts';
import {api} from '../../../../shared/api/client';
import {AUTO_REFRESH,useApiQuery} from '../../../../shared/api/useApi';
import {useT} from '../../../../shared/lib/useT';
import {Card} from '../../../../shared/ui/Card';
import {DataTable} from '../../../../shared/ui/DataTable';
import {QueryStatus} from '../../../../shared/ui/QueryStatus';
import {EmptyState} from '../../../../shared/ui/EmptyState';
import {runtimeDate} from '../../model/runtimeFormat';
import styles from '../RuntimeStatistics.module.css';
export function RuntimeOperationalTelemetry({projectId,window}:{projectId?:string;window:OperationalTelemetryQuery}) {
 const t=useT(),[excludeMaintenance,setExcludeMaintenance]=useState(false),query=useApiQuery(['runtime-operational',projectId??'system',window,excludeMaintenance],async()=>OperationalTelemetrySchema.parse(await api.observability.operationalTelemetry(projectId,{...window,excludeMaintenance})),AUTO_REFRESH),data=query.error?undefined:query.data;
 const count=(value:string)=>BigInt(value).toLocaleString();
 return <Card title={t(projectId?'runtime.telemetry.service':'runtime.telemetry.platform')} stacked footer={t('runtime.telemetry.sampling')}>
  <ChoiceField label={t('runtime.telemetry.excludeMaintenance')} checked={excludeMaintenance} onChange={e=>setExcludeMaintenance(e.target.checked)}/>{data?.excludedMaintenanceRequests?<p>{t('runtime.telemetry.excludedMaintenance',{count:data.excludedMaintenanceRequests})}</p>:null}
  <QueryStatus isPending={query.isPending} error={query.error}/>
  {data?<><p className={styles.hint}>{t('runtime.telemetry.state.'+data.state)} · {runtimeDate(data.from)} — {runtimeDate(data.to)} · {t('runtime.observed')}: {data.observedAt?runtimeDate(data.observedAt):'—'}</p>
   {data.gauges?.length?<DataTable columns={[t('runtime.component'),t('runtime.telemetry.metric'),t('runtime.telemetry.value'),t('runtime.state'),t('runtime.observed')]}>{data.gauges.map(row=><tr key={row.key}><td>{row.component}<span className={styles.identity}>{row.replica??row.source} {Object.values(row.dimensions??{}).join(' · ')}</span></td><td>{t('runtime.signal.'+row.kind)}<span className={styles.identity}>{row.unit}</span></td><td>{row.value??'—'}</td><td>{t('runtime.signalState.'+row.state)}</td><td>{runtimeDate(row.observedAt)}</td></tr>)}</DataTable>:null}
   {data.rows.length?<DataTable columns={[t('runtime.component'),t('runtime.telemetry.route'),t('runtime.telemetry.requests'),t('runtime.telemetry.errors'),t('runtime.telemetry.p95'),t('runtime.telemetry.streams')]}>{data.rows.map(row=><tr key={row.key}><td>{row.component}</td><td>{row.route}{row.role?<span className={styles.identity}>{t('runtime.role.'+row.role)} · {row.releaseName??t('runtime.unknown')}{row.maintenance?' · '+t('runtime.maintenanceObserved'):''}</span>:null}{row.physicalService?<span className={styles.identity}>{row.physicalService}</span>:null}</td><td>{count(row.requests)}</td><td>4xx {count(row.errors4xx)} · 5xx {count(row.errors5xx)} · 429 {count(row.limited)}</td><td>{row.p95UpperMs===null?'—':`≤ ${row.p95UpperMs} ms`}<span className={styles.identity}>{t('runtime.telemetry.samples',{count:row.samples})}</span></td><td>{t('runtime.telemetry.connections',{opened:count(row.streamOpened),closed:count(row.streamClosed),cancelled:count(row.streamCancelled),active:row.activeStreams??'—'})}</td></tr>)}</DataTable>:<EmptyState title={t('runtime.telemetry.state.'+data.state)}/>}</>:null}
 </Card>;
}
