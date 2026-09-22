import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { DeliveriesCard } from '../../features/events';
import { AlertsPage, HealthCards, LogsPage, TopologyPage, TracePage } from '../../features/logs';
import { useT } from '../../shared/lib/useT';
import { PROJECT_PATHS } from '../../shared/project/projectPaths';
import { useProjectScope } from '../../shared/project/ProjectScope';
import { OPERATIONS_TABS, parseOperationsSearch } from '../../shared/project/operationsSearch';
import type { OperationsSearch } from '../../shared/project/operationsSearch';
import { PageHeader } from '../../shared/ui/PageHeader';
import { Stack } from '../../shared/ui/Stack';
import { Tabs } from '../../shared/ui/Tabs';
import styles from './ProjectSections.module.css';

/** 运行与诊断：五个横向页签（RFC-020 D3）；「状态」把两槽健康卡与形态全图放在同一页。 */
export function ProjectOperationsPage() {
  const t = useT(), { projectId, space } = useProjectScope(), navigate = useNavigate();
  const search = parseOperationsSearch(useSearch({ strict: false })), tab = search.tab ?? 'status';
  const change = (next: OperationsSearch, replace = false) => { void navigate({ to: PROJECT_PATHS[space].operations, params: { projectId }, search: next, replace }); };
  const logs = (slot: 'prod' | 'preview') => change({ tab: 'logs', source: 'slot', slot });
  return <div className={styles.page}>
    <PageHeader title={t('nav.operations')} />
    <Tabs label={t('nav.operations')} value={tab} items={OPERATIONS_TABS.map((value) => ({ value, label: t(`operations.tab.${value}`) }))} onChange={(value) => change({ tab: OPERATIONS_TABS.find((item) => item === value) })}>
      {tab === 'status' ? <Stack key={projectId}><HealthCards projectId={projectId} onLogs={logs} /><TopologyPage projectId={projectId} onLogs={(next) => change({ ...next, tab: 'logs' })} /></Stack> : null}
      {tab === 'logs' ? <LogsPage key={projectId} filters={search} changeFilters={(next) => change({ ...next, tab: 'logs' }, true)} /> : null}
      {tab === 'alerts' ? <AlertsPage key={projectId} projectId={projectId} search={search} change={change} onLogs={logs} /> : null}
      {tab === 'trace' ? <TracePage key={`${projectId}:${search.traceId ?? ''}`} projectId={projectId} traceId={search.traceId} onTrace={(traceId) => change({ tab: 'trace', traceId })} /> : null}
      {tab === 'deliveries' ? <>
        <div className={styles.actions}><Link to={PROJECT_PATHS[space].resources} params={{ projectId }} search={{ section: 'events', subscription: search.subscription }}>{t('operations.viewSubscriptions')}</Link></div>
        <DeliveriesCard key={`${projectId}:${search.subscription ?? ''}`} projectId={projectId} subscription={search.subscription} onClearSubscription={() => change({ tab })} onTrace={(traceId) => change({ tab: 'trace', traceId })} />
      </> : null}
    </Tabs>
  </div>;
}
