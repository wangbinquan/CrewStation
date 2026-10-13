import type {RuntimeFragment,RuntimeReportHeader} from '@crewstation/contracts';
import {Card} from '../../../shared/ui/Card';
import {DataTable} from '../../../shared/ui/DataTable';
import {RuntimeRows} from './RuntimeRows';
import {useT} from '../../../shared/lib/useT';
import {runtimeDate} from '../model/runtimeFormat';
import styles from './RuntimeStatistics.module.css';
export function RuntimeFragments({header,taskId}:{header:RuntimeReportHeader;taskId:string}){const t=useT();return <Card title={t('runtime.fragments')} stacked footer={t('runtime.fragmentsHint')}><RuntimeRows<RuntimeFragment> header={header} section="fragments" parent={taskId}>{rows=><DataTable columns={[t('runtime.agent'),t('runtime.phase'),t('runtime.tool'),t('runtime.nativeSession'),t('runtime.observed')]}>{rows.map(row=><tr key={row.key}><td>{row.agentId}</td><td>{t('runtime.fragment.'+row.kind)}<span className={styles.identity}>{row.source}</span></td><td>{row.toolName??'—'}<span className={styles.identity}>{row.toolId}</span></td><td>{row.sessionId??'—'}<span className={styles.identity}>{row.parentSessionId}</span></td><td>{runtimeDate(row.occurredAt)}</td></tr>)}</DataTable>}</RuntimeRows></Card>;}
