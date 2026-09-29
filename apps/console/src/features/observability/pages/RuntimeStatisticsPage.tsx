import { rememberRuntimeList, runtimeReturnKey, useRuntimeListReturn } from '../hooks/useRuntimeListReturn';
import { useState } from 'react';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import type { RuntimeStatistics } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { AUTO_REFRESH, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { useProjectScope } from '../../../shared/project/ProjectScope';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { Stack } from '../../../shared/ui/Stack';
import { Button } from '../../../shared/ui/Button';
import { Tabs } from '../../../shared/ui/Tabs';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { ButtonLink } from '../../../shared/ui/navigation/ButtonLink';
import type { ReactNode } from 'react';
import { RuntimeResourceMetrics } from '../components/RuntimeResourceMetrics';
import { RuntimeHealth } from '../components/RuntimeHealth';
import { RuntimeAnalysis } from '../components/RuntimeAnalysis';
import { RuntimeFilters } from '../components/RuntimeFilters';
import { RuntimeTaskView } from '../components/RuntimeTaskView';
import { RUNTIME_TABS, parseRuntimeSearch, runtimeWindow, type RuntimeSearch } from '../model/runtimeSearch';
import { runtimeDate } from '../model/runtimeFormat';
import styles from '../components/RuntimeStatistics.module.css';

interface PageProps { projectId?: string; taskId?: string; go: (search: RuntimeSearch, taskId?: string) => void }
function RuntimeViewTabs({ projectId, search, change, children }: { projectId?: string; search: RuntimeSearch; change: (next: RuntimeSearch) => void; children: ReactNode }) {
  const t = useT(); return <Tabs label={t('runtime.title')} value={search.tab ?? 'overview'} items={RUNTIME_TABS.map((tab) => ({ value: tab, label: t(tab === 'health' && !projectId ? 'runtime.tab.platform' : 'runtime.tab.' + tab) }))} onChange={(tab) => change({ ...search, tab: RUNTIME_TABS.find((x) => x === tab) })}>{children}</Tabs>;
}
function RuntimeTaskPage({ projectId, taskId, go }: PageProps & { taskId: string }) {
  const t = useT(), search = parseRuntimeSearch(useSearch({ strict: false }));
  const query = useApiQuery(['runtime-task', projectId ?? 'system', taskId], () => projectId ? api.observability.projectRuntimeTask(projectId, taskId) : api.observability.systemRuntimeTask(taskId), AUTO_REFRESH);
  return <Stack className={styles.page}><QueryStatus isPending={query.isPending} error={query.error} />
    {!query.error && query.data ? <RuntimeTaskView task={query.data} back={() => go(search)} /> : <Button onClick={() => go(search)}>{t('runtime.back')}</Button>}
  </Stack>;
}
function RuntimeOverviewPage({ projectId, go }: PageProps) {
  const t = useT(), search = parseRuntimeSearch(useSearch({ strict: false }));
  const [initialNow] = useState(() => Date.now());
  const window = runtimeWindow(search, initialNow), operations = search.tab === 'resources' || search.tab === 'health';
  const filters = { ...window, q: search.q, state: search.state, quality: search.quality };
  const query = useApiQuery<RuntimeStatistics>(['runtime-statistics', projectId ?? 'system', filters], () => projectId ? api.observability.projectRuntimeStatistics(projectId, filters) : api.observability.systemRuntimeStatistics(filters), { ...AUTO_REFRESH, enabled: !operations });
  const change = (next: RuntimeSearch) => go({ ...search, from: window.from, to: window.to, ...next });
  const data = operations || query.error ? undefined : query.data;
  const current = { ...search, from: window.from, to: window.to }, returnKey = runtimeReturnKey(projectId ?? 'system', current);
  useRuntimeListReturn(returnKey, data !== undefined);
  const openTask = (id: string) => { rememberRuntimeList(returnKey, id); go(current, id); };
  return <Stack className={styles.page} data-runtime-statistics>
    <PageHeader title={t(projectId ? 'runtime.projectTitle' : 'runtime.systemTitle')} description={t(operations ? 'runtime.operationsDescription' : 'runtime.description')}
      meta={data ? t('runtime.snapshot', { at: runtimeDate(data.asOf, window.timezone), zone: window.timezone }) : undefined}
      actions={!operations && !projectId ? <ButtonLink to="/admin/compute" search={{ tab: 'pricing' }}>{t('runtime.configurePricing')}</ButtonLink> : undefined} />
    {!operations ? <RuntimeFilters key={window.from + window.to} window={window} search={search} change={change} states={[...new Set([...(data?.tasks.map((task) => task.state) ?? []), ...(search.state ? [search.state] : [])])]} /> : null}
    {!operations ? <QueryStatus isPending={query.isPending} error={query.error} /> : null}
    <RuntimeViewTabs projectId={projectId} search={search} change={change}>{search.tab === 'resources' ? <RuntimeResourceMetrics projectId={projectId} search={search} change={change} /> : search.tab === 'health' ? <RuntimeHealth projectId={projectId} /> : data ? <Stack><p className={styles.hint}>{t('runtime.scopeHint', { tasks: data.limits.tasks, attempts: data.limits.attempts, records: data.limits.records })}</p>
      {data.partial ? <p role="status" className={styles.notice}>{t('runtime.partial')}</p> : null}
      <RuntimeAnalysis data={data} search={search} change={change} task={openTask} />
    </Stack> : null}</RuntimeViewTabs>
  </Stack>;
}
export function SystemRuntimeStatisticsPage() {
  const navigate = useNavigate(), { taskId } = useParams({ strict: false });
  const go = (search: RuntimeSearch, id?: string) => { if (id) void navigate({ to: '/admin/observability/tasks/$taskId', params: { taskId: id }, search, resetScroll: true }); else void navigate({ to: '/admin/observability', search, resetScroll: false }); };
  return taskId ? <RuntimeTaskPage taskId={taskId} go={go} /> : <RuntimeOverviewPage go={go} />;
}
export function ProjectRuntimeStatisticsPage() {
  const navigate = useNavigate(), { projectId, space } = useProjectScope(), { taskId } = useParams({ strict: false });
  const go = (search: RuntimeSearch, id?: string) => {
    if (id) void navigate({ to: space === 'admin' ? '/admin/integrations/$projectId/observability/tasks/$taskId' : '/projects/$projectId/observability/tasks/$taskId', params: { projectId, taskId: id }, search, resetScroll: true });
    else void navigate({ to: space === 'admin' ? '/admin/integrations/$projectId/observability' : '/projects/$projectId/observability', params: { projectId }, search, resetScroll: false });
  };
  return taskId ? <RuntimeTaskPage projectId={projectId} taskId={taskId} go={go} /> : <RuntimeOverviewPage projectId={projectId} go={go} />;
}
