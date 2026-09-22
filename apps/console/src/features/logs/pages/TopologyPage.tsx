// 运行与诊断「部署与运行形态」页签（RFC-019）：项目范围只读盘点＋槽＋开发会话＋数据资源组装成图；15 秒轮询、换快照不卸载。
import { useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import type { OperationsSearch } from '../../../shared/project/operationsSearch';
import { useProjectIdentity } from '../../../shared/project/useProjectIdentity';
import { buildProjectTopology } from '../../../shared/topology/projectTopology';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { TopologyWorkspace } from '../../../shared/ui/topology/TopologyWorkspace';
import { TopologyDetail } from '../components/TopologyDetail';

export function TopologyPage({ projectId, onLogs }: { readonly projectId: string; readonly onLogs: (next: OperationsSearch) => void }): ReactElement {
  const t = useT(), identity = useProjectIdentity(projectId), [selected, setSelected] = useState<string>();
  const project = identity.data, serviceId = project?.serviceId;
  const inventory = useApiQuery(queryKeys.projectClusterResources(projectId), () => api.cluster.projectResources(projectId), { refetchIntervalMs: 15_000, refetchOnWindowFocus: true, keepPrevious: () => true });
  const slots = useApiQuery(queryKeys.slots(serviceId ?? ''), () => api.services.listSlots(serviceId!), { enabled: !!serviceId, refetchIntervalMs: 15_000 });
  const devSession = useApiQuery(queryKeys.devSession(projectId), () => api.devSession.get(projectId), { refetchIntervalMs: 15_000 });
  const dataResources = useApiQuery(queryKeys.dataResources(projectId), () => api.tasks.listDataResources(projectId));
  const topology = useMemo(() => project && inventory.data ? buildProjectTopology({
    project: { id: project.id, name: project.name, kind: project.kind, namespace: project.namespace }, resources: inventory.data.items, slots: slots.data?.items ?? [],
    devSession: devSession.data && !devSession.error ? devSession.data : undefined, dataResources: dataResources.data?.items ?? [],
    snapshot: { id: inventory.data.snapshotId, observedAt: inventory.data.observedAt, complete: inventory.data.complete, incompleteReason: inventory.data.complete ? undefined : inventory.data.sources.filter((s) => s.state === 'error' || s.state === 'stale').map((s) => `${s.kind}${s.reason ? `（${s.reason}）` : ''}`).join('、') },
  }, t) : undefined, [project, inventory.data, slots.data, devSession.data, devSession.error, dataResources.data, t]);
  // 开发会话不存在是 404，不是页面错误；其余查询的错误照常显示。
  const error = identity.error ?? inventory.error ?? slots.error ?? dataResources.error ?? (devSession.error && devSession.error.status !== 404 ? devSession.error : null);
  return <>
    <QueryStatus isPending={!error && (identity.isPending || inventory.isPending)} error={error} isEmpty={topology !== undefined && topology.nodes.length === 0} emptyTitle={t('logs.topology.emptyTitle')} emptyDescription={t('logs.topology.emptyDescription')} />
    {topology && topology.nodes.length > 0 ? <TopologyWorkspace topology={topology} label={topology.title} selectedId={selected} onSelect={setSelected}
      before={inventory.data?.truncated ? <p>{t('logs.topology.truncated')}</p> : undefined}
      detail={selected ? <TopologyDetail topology={topology} nodeId={selected} resources={inventory.data?.items ?? []} onSelect={setSelected} onClose={() => setSelected(undefined)} onLogs={onLogs} /> : undefined} /> : null}
  </>;
}
