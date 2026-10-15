import { useMemo } from 'react';
import { ProjectClusterResourcesSchema } from '@crewstation/contracts';
import type { ResourceSourceStatus } from '@crewstation/contracts';
import { api } from '../api/client';
import { queryKeys } from '../api/queryKeys';
import { useApiQuery } from '../api/useApi';
import { useT } from '../lib/useT';
import { useProjectIdentity } from '../project/useProjectIdentity';
import { useProjectResources } from '../resources/useProjectResources';
import { buildProjectTopology } from './projectTopology';
import type { ProjectTopologyInput } from './projectTopology';

/** The diagnostic and resource pages share queries, stream ownership and source completeness. */
export function useProjectTopology(projectId: string) {
  const t = useT(), identity = useProjectIdentity(projectId), project = identity.data, serviceId = project?.serviceId;
  const inventory = useApiQuery(queryKeys.projectClusterResources(projectId), async () => {
    const parsed = ProjectClusterResourcesSchema.safeParse(await api.cluster.projectResources(projectId));
    if (!parsed.success) throw new Error(t('logs.topology.invalidResponse'));
    return parsed.data;
  }, { refetchIntervalMs: 15_000, refetchOnWindowFocus: true, keepPrevious: () => true });
  const slots = useApiQuery(queryKeys.slots(serviceId ?? ''), () => api.services.listSlots(serviceId!), { enabled: !!serviceId, refetchIntervalMs: 15_000 });
  const devSession = useApiQuery(queryKeys.devSession(projectId), () => api.devSession.get(projectId), { refetchIntervalMs: 15_000 });
  const dataResources = useApiQuery(queryKeys.dataResources(projectId), () => api.tasks.listDataResources(projectId), { refetchIntervalMs: 15_000 });
  const records = useProjectResources(projectId);
  const queries = [identity, inventory, slots, devSession, dataResources, records];
  const forbidden = queries.some((q) => q.error && [401, 403].includes(q.error.status)) || identity.error?.status === 404;
  const sources: ResourceSourceStatus[] = queries.map((query, i) => ({
    id: ['project', 'inventory', 'slots', 'development', 'databases', 'runtime'][i]!,
    name: t(`resourceCenter.deployment.source.${['project', 'inventory', 'slots', 'development', 'databases', 'runtime'][i]}`),
    observedAt: i === 1 ? inventory.data?.observedAt ?? null : query.dataUpdatedAt ? new Date(query.dataUpdatedAt).toISOString() : null,
    complete: i === 3 && devSession.error?.status === 404 || query.isSuccess && !query.error && (i !== 1 || inventory.data?.complete === true && !inventory.data.truncated),
    error: i === 3 && devSession.error?.status === 404 ? null : query.error?.message ?? (query.isPending ? t('resourceCenter.deployment.loadingSource') : i === 1 && inventory.data?.truncated ? t('logs.topology.truncated') : null),
  }));
  const complete = sources.every((source) => source.complete), incompleteReason = sources.filter((source) => !source.complete).map((source) => `${source.name}${source.error ? `: ${source.error}` : ''}`).join(' · ');
  const input = useMemo((): ProjectTopologyInput | undefined => project && inventory.data && records.data && !forbidden ? {
    project: { id: project.id, name: project.name, kind: project.kind, namespace: project.namespace }, resources: inventory.data.items,
    slots: slots.data?.items ?? [], devSession: devSession.data && !devSession.error ? devSession.data : undefined,
    dataResources: dataResources.data?.items ?? [], records: records.data.items,
    snapshot: { id: inventory.data.snapshotId, observedAt: inventory.data.observedAt, complete, incompleteReason },
  } : undefined, [project, inventory.data, slots.data, devSession.data, devSession.error, dataResources.data, records.data, forbidden, complete, incompleteReason]);
  const topology = useMemo(() => input ? buildProjectTopology(input, t) : undefined, [input, t]);
  const error = identity.error ?? inventory.error ?? slots.error ?? dataResources.error ?? records.error ?? (devSession.error?.status === 404 ? null : devSession.error);
  return { input, topology, sources, error, isPending: !error && (identity.isPending || inventory.isPending || records.isPending), resources: inventory.data?.items ?? [], truncated: inventory.data?.truncated ?? false };
}
