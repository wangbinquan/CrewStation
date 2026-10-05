import type { ReactNode } from 'react';
import { ProjectDeletionWorkflow } from '../../features/projects/components/ProjectDeletionWorkflow';
import { ProjectDeletionSlot } from '../../shared/admin/ProjectDeletionSlot';
import { api } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/queryKeys';
import { AUTO_REFRESH, useApiQuery } from '../../shared/api/useApi';

/** Current administrator identity and actual server capability gate both entries. */
export function ProjectDeletionProvider({ children }: { readonly children: ReactNode }) {
  const me = useApiQuery(queryKeys.me(), () => api.me.get());
  const admin = !me.error && me.data?.isAdmin === true;
  const capability = useApiQuery(queryKeys.projectDeletionCapabilities(me.data?.id ?? ''), () => api.projectDeletions.capabilities(), { enabled: admin, ...AUTO_REFRESH });
  const available = admin && !capability.error && capability.data?.available === true;
  return <ProjectDeletionSlot key={me.data?.id} available={available} renderDialog={slot =>
    <ProjectDeletionWorkflow key={`${me.data!.id}:${slot.project.id}`} {...slot} userId={me.data!.id} open />
  }>{children}</ProjectDeletionSlot>;
}
