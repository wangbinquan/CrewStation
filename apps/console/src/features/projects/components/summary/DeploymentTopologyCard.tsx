// 概览的「部署与运行形态」卡（RFC-019）：一行横带汇总卡铺满内容区；点任一卡进运行与诊断的全图。测试员不看。
import { useMemo } from 'react';
import type { ReactElement } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ProjectClusterResourcesSchema } from '@crewstation/contracts';
import type { ProjectSummaryDetail } from '@crewstation/contracts';
import { api } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { useApiQuery } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { PROJECT_PATHS } from '../../../../shared/project/projectPaths';
import type { ProjectSpace } from '../../../../shared/project/projectPaths';
import { bandSummaryTopology } from '../../../../shared/topology/bandSummary';
import { buildProjectTopology } from '../../../../shared/topology/projectTopology';
import { Badge } from '../../../../shared/ui/Badge';
import { Card } from '../../../../shared/ui/Card';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import { TopologyDiagram } from '../../../../shared/ui/topology/TopologyDiagram';
import { SUMMARY_METRICS } from '../../../../shared/ui/topology/topologyLayout';
import styles from './ProjectSummary.module.css';
import { ButtonLink } from '../../../../shared/ui/navigation/ButtonLink';

export function DeploymentTopologyCard({ item, space }: { readonly item: ProjectSummaryDetail; readonly space: ProjectSpace }): ReactElement | null {
  const t = useT(), navigate = useNavigate(), projectId = item.project.id;
  const inventory = useApiQuery(queryKeys.projectClusterResources(projectId), async () => { const parsed = ProjectClusterResourcesSchema.safeParse(await api.cluster.projectResources(projectId)); if (!parsed.success) throw new Error(t('projects.summary.topology.invalidResponse')); return parsed.data; }, { enabled: item.role !== 'tester', refetchIntervalMs: 15_000, refetchOnWindowFocus: true, keepPrevious: () => true });
  const dataResources = useApiQuery(queryKeys.dataResources(projectId), () => api.tasks.listDataResources(projectId), { enabled: item.role !== 'tester' });
  const topology = useMemo(() => {
    if (!inventory.data) return undefined;
    const development = item.development.status === 'ready' && item.development.value ? item.development.value : undefined;
    return buildProjectTopology({
      project: { id: projectId, name: item.project.name, kind: item.project.kind, namespace: item.project.namespace }, resources: inventory.data.items, slots: item.slots.status === 'ready' ? item.slots.value : [],
      devSession: development ? { taskId: development.taskId, state: development.state === 'paused' ? 'running' : development.state, branch: development.branch ?? '' } : undefined, dataResources: dataResources.data?.items ?? [],
      snapshot: { id: inventory.data.snapshotId, observedAt: inventory.data.observedAt, complete: inventory.data.complete },
    }, t);
  }, [inventory.data, dataResources.data, item, projectId, t]);
  if (item.role === 'tester') return null;
  const open = () => { void navigate({ to: PROJECT_PATHS[space].operations, params: { projectId }, search: { tab: 'topology' } }); };
  const pods = topology?.nodes.filter((n) => n.kind === 'pod') ?? [], abnormal = topology?.nodes.filter((n) => n.abnormal).length ?? 0;
  return <Card compact title={t('projects.summary.topology.title')} actions={<ButtonLink to={PROJECT_PATHS[space].operations} params={{ projectId }} search={{ tab: 'topology' }}>{t('projects.summary.topology.open')}</ButtonLink>}>
    <QueryStatus isPending={inventory.isPending} error={inventory.error ?? dataResources.error} />
    {topology ? <>
      <p className={styles.fact}>{t('projects.summary.topology.counts', { workloads: topology.nodes.filter((n) => n.kind === 'workload' || n.kind === 'job').length, pods: pods.length, ready: pods.filter((n) => n.status === 'ready').length, running: pods.filter((n) => n.status === 'running').length })}{abnormal > 0 ? <> · <Badge tone="warning">{t('projects.summary.topology.attention', { count: abnormal })}</Badge></> : null}</p>
      {topology.nodes.length > 0 ? <TopologyDiagram topology={bandSummaryTopology(topology, t)} metrics={SUMMARY_METRICS} label={t('projects.summary.topology.title')} onSelect={(id) => { if (id) open(); }} /> : null}
      <p className={styles.muted}>{topology.nodes.length > 0 ? t('projects.summary.topology.hint') : t('projects.summary.topology.empty')}</p>
    </> : null}
  </Card>;
}
