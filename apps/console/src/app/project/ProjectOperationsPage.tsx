import { useNavigate, useSearch } from '@tanstack/react-router';
import { DeliveriesCard } from '../../features/events';
import { AlertsPage, HealthCards, LogsPage, TopologyPage } from '../../features/logs';
import { TracesPage } from '../../features/traces';
import { useT } from '../../shared/lib/useT';
import { PROJECT_PATHS } from '../../shared/project/projectPaths';
import { useProjectScope } from '../../shared/project/ProjectScope';
import { OPERATIONS_TABS, parseOperationsSearch } from '../../shared/project/operationsSearch';
import type { OperationsSearch } from '../../shared/project/operationsSearch';
import { PageHeader } from '../../shared/ui/PageHeader';
import { Tabs } from '../../shared/ui/Tabs';
import styles from './ProjectSections.module.css';
import { ButtonLink } from '../../shared/ui/navigation/ButtonLink';

/** 运行与诊断：六个横向页签，部署与运行形态在最前（2026-09-23 修订 RFC-020 D3：健康与形态重新分成两个页签）。 */
export function ProjectOperationsPage() {
  const t = useT(), { projectId, space } = useProjectScope(), navigate = useNavigate();
  const search = parseOperationsSearch(useSearch({ strict: false })), tab = search.tab ?? 'topology';
  const change = (next: OperationsSearch, replace = false, resetScroll = true) => { void navigate({ to: PROJECT_PATHS[space].operations, params: { projectId }, search: next, replace, resetScroll }); };
  const logs = (slot: 'prod' | 'preview') => change({ tab: 'logs', source: 'slot', slot });
  return <div className={styles.page}>
    <PageHeader title={t('nav.operations')} />
    <Tabs label={t('nav.operations')} value={tab} items={OPERATIONS_TABS.map((value) => ({ value, label: t(`operations.tab.${value}`) }))} onChange={(value) => change({ tab: OPERATIONS_TABS.find((item) => item === value) })}>
      {tab === 'topology' ? <TopologyPage key={projectId} projectId={projectId} onLogs={(next) => change({ ...next, tab: 'logs' })} /> : null}
      {tab === 'health' ? <HealthCards key={projectId} projectId={projectId} onLogs={logs} /> : null}
      {tab === 'logs' ? <LogsPage key={projectId} filters={search} changeFilters={(next) => change({ ...next, tab: 'logs' }, true)} /> : null}
      {tab === 'alerts' ? <AlertsPage key={projectId} projectId={projectId} search={search} change={change} onLogs={logs} /> : null}
      {/* 调用链页签里选中与筛选是页内的切换：不复位滚动，否则在长列表下方点选时整页跳回顶部，窄屏滚到详情的动作也被冲掉（同集群管理）。 */}
      {tab === 'trace' ? <TracesPage key={projectId} projectId={projectId} search={search} onChange={(next, replace) => change({ ...next, tab: 'trace' }, replace, false)} /> : null}
      {tab === 'deliveries' ? <>
        <div className={styles.actions}><ButtonLink to={PROJECT_PATHS[space].development} params={{ projectId }} search={{ view: 'reference', panel: 'full', topic: 'events', subscription: search.subscription }}>{t('operations.viewSubscriptions')}</ButtonLink></div>
        <DeliveriesCard key={`${projectId}:${search.subscription ?? ''}`} projectId={projectId} subscription={search.subscription} onClearSubscription={() => change({ tab })} onTrace={(traceId) => change({ tab: 'trace', traceId })} />
      </> : null}
    </Tabs>
  </div>;
}
