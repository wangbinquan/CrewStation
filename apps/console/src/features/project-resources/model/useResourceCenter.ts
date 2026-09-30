import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ProjectResourceSnapshotSchema } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { useApiQuery, AUTO_REFRESH } from '../../../shared/api/useApi';
import { useProjectResources } from '../../../shared/resources/useProjectResources';

export const resourceCenterKey = (projectId: string) => ['resource-center', projectId] as const;
export function useResourceCenter(projectId: string) {
  const client = useQueryClient();
  const query = useApiQuery(resourceCenterKey(projectId), async () => ProjectResourceSnapshotSchema.parse(await api.resourceCenter.snapshot(projectId)), { enabled: !!projectId, ...AUTO_REFRESH });
  const live = useProjectResources(projectId, { enabled: !!query.data && !query.error });
  const previous = useRef<number | undefined>(undefined), cursor = live.data?.cursor;
  useEffect(() => { const changed = previous.current !== undefined && cursor !== previous.current; previous.current = cursor; if (!changed) return; const timer = setTimeout(() => { void client.invalidateQueries({ queryKey: resourceCenterKey(projectId) }); }, 1000); return () => clearTimeout(timer); }, [cursor, projectId, client]);
  return query;
}
