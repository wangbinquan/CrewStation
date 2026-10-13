import type {RuntimeAggregate,RuntimeStatisticsQuery} from '@crewstation/contracts';
import {RuntimeTrend} from './RuntimeTrend';
import {RuntimeTokenMetric,RuntimeCostMetric} from './RuntimeMetrics';
import {ActionRow} from '../../../shared/ui/ActionRow';
import {Stack} from '../../../shared/ui/Stack';
import {useT} from '../../../shared/lib/useT';
import type {RuntimeSearch} from '../model/runtimeSearch';
import styles from './RuntimeStatistics.module.css';
export function RuntimeOccurrence({data,window,search,change}:{data:NonNullable<RuntimeAggregate['occurrence']>;window:RuntimeStatisticsQuery;search:RuntimeSearch;change:(q:RuntimeSearch)=>void}){const t=useT(),summary={tasks:data.tasks,metrics:data.metrics,trend:data.trend,durations:{state:'not-ready' as const,gaps:[]},sources:[]};return <Stack><RuntimeTrend summary={summary} header={{filters:window}} search={search} change={change} titleKey="runtime.occurrenceTrend" hintKey="runtime.occurrenceHint" occurrence/><ActionRow><span className={styles.hint}>{t('runtime.unassignedTime')}</span><RuntimeTokenMetric metrics={data.unassigned.metrics}/><RuntimeCostMetric metrics={data.unassigned.metrics}/></ActionRow></Stack>;}
