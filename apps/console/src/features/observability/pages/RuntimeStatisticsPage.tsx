import { useParams, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { useT } from '../../../shared/lib/useT';
import { useProjectScope } from '../../../shared/project/ProjectScope';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { Segmented } from '../../../shared/ui/Segmented';
import { Stack } from '../../../shared/ui/Stack';
import { Tabs } from '../../../shared/ui/Tabs';
import { RuntimeAgents } from '../components/RuntimeAgents';
import { RuntimeHealth } from '../components/RuntimeHealth';
import { RuntimeOverview } from '../components/RuntimeOverview';
import { RuntimePlatform } from '../components/RuntimePlatform';
import { RuntimeProjects } from '../components/RuntimeProjects';
import { RuntimeResourceMetrics } from '../components/RuntimeResourceMetrics';
import { RuntimeTaskDetail } from '../components/RuntimeTaskDetail';
import { RuntimeTasks } from '../components/RuntimeTasks';
import { useRuntimeNavigation } from '../hooks/useRuntimeNavigation';
import type { RuntimePeriod, RuntimeScope, RuntimeSearch, RuntimeTab } from '../model/runtimeSearch';
import { DEFAULT_PERIOD, RUNTIME_PERIODS, STATISTICS_TABS, observationWindow, parseRuntimeSearch, runtimeTabs, scopeProjectId } from '../model/runtimeSearch';
import styles from '../components/RuntimeStatistics.module.css';

/** RFC-034 v2 §6：系统与项目「运行观测与统计」共用这一页；任务详情是同一层级下的独立路由。 */
function RuntimeStatisticsView({ scope }: { scope: RuntimeScope }) {
  const t = useT(), search = parseRuntimeSearch(useSearch({ strict: false })), go = useRuntimeNavigation(scope);
  const tabs = runtimeTabs(scope), tab: RuntimeTab = search.tab && tabs.includes(search.tab) ? search.tab : 'overview', period = search.period ?? DEFAULT_PERIOD;
  const statistics = STATISTICS_TABS.includes(tab);
  const periodControl = statistics ? <Segmented label={t('runtime.period')} value={period}
    items={RUNTIME_PERIODS.map((value) => ({ value, label: t('runtime.period.' + value) }))}
    onChange={(value) => go({ ...search, period: value as RuntimePeriod })} /> : undefined;
  return <Stack className={styles.page} data-runtime-statistics="">
    <PageHeader title={t(scope.kind === 'system' ? 'runtime.systemTitle' : 'runtime.projectTitle')} description={t(statistics ? 'runtime.description' : 'runtime.operationsDescription')} />
    <Tabs label={t('runtime.title')} value={tab} extra={periodControl}
      items={tabs.map((value) => ({ value, label: t('runtime.tab.' + value) }))} onChange={(value) => go({ ...search, tab: value as RuntimeTab })}>
      <RuntimePanel scope={scope} tab={tab} period={period} search={search} go={go} />
    </Tabs>
  </Stack>;
}

function RuntimePanel({ scope, tab, period, search, go }: { scope: RuntimeScope; tab: RuntimeTab; period: RuntimePeriod; search: RuntimeSearch; go: (search: RuntimeSearch) => void }) {
  const projectId = scopeProjectId(scope), [opened] = useState(() => Date.now());
  switch (tab) {
    case 'tasks': return <RuntimeTasks scope={scope} period={period} search={search} change={go} />;
    case 'agents': return <RuntimeAgents scope={scope} period={period} />;
    case 'projects': return <RuntimeProjects period={period} />;
    case 'platform': return <RuntimePlatform period={period} />;
    case 'resources': return <RuntimeResourceMetrics projectId={projectId} search={search} change={go} />;
    case 'health': {
      // 运行遥测沿用原实现的最近 24 小时（打开页签时取定）。
      const window = observationWindow('day', opened);
      return <RuntimeHealth projectId={projectId} window={{ from: window.from, to: window.to }} />;
    }
    default: return <RuntimeOverview scope={scope} period={period} search={search} />;
  }
}

export function SystemRuntimeStatisticsPage() {
  const { taskId } = useParams({ strict: false }), scope: RuntimeScope = { kind: 'system' };
  return taskId ? <RuntimeTaskDetail scope={scope} taskId={taskId} /> : <RuntimeStatisticsView scope={scope} />;
}

export function ProjectRuntimeStatisticsPage() {
  const { projectId, space } = useProjectScope(), { taskId } = useParams({ strict: false });
  const scope: RuntimeScope = { kind: 'project', projectId, space };
  return taskId ? <RuntimeTaskDetail scope={scope} taskId={taskId} /> : <RuntimeStatisticsView key={projectId} scope={scope} />;
}
