import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { UserIdSchema } from '@crewstation/contracts';
import type { ProjectDeletionsResource } from '@crewstation/api-client';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { usePollingRefetch } from '../../../shared/lib/usePollingRefetch';
import { useT } from '../../../shared/lib/useT';
import { ProjectDeletionSession } from '../model/deletionSession';
import type { DeletionRequestStore } from '../model/deletionSession';

/** Keep the original confirmation across modal close/reload; hidden windows never poll or replay. */
export function useProjectDeletion(projectId: string, userId: string, open: boolean, resource: ProjectDeletionsResource = api.projectDeletions) {
  const t = useT(), queries = useQueryClient();
  const session = useMemo(() => new ProjectDeletionSession(projectId, resource, requestStore(userId)), [projectId, userId, resource]);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const refresh = useCallback(() => { void session.refresh(); }, [session]);
  useEffect(() => { if (open) void session.open(); }, [open, session]);
  usePollingRefetch(refresh, 5000, open && (state.pending || state.error === 'read-failed' || !!state.operation && state.operation.state !== 'succeeded'));
  useEffect(() => {
    if (state.operation?.state !== 'succeeded') return;
    for (const queryKey of [queryKeys.projects(), queryKeys.gateway(), ['market']]) void queries.invalidateQueries({ queryKey });
  }, [queries, state.operation?.id, state.operation?.state]);
  return { ...state, session, canRecover: session.hasRetainedRequest(), error: state.error ? t(`projects.delete.error.${state.error}`) : undefined };
}

function requestStore(userId: string): DeletionRequestStore {
  UserIdSchema.parse(userId);
  const key = (projectId: string) => `crewstation:project-deletion:v1:${userId}:${projectId}`;
  return {
    read: (projectId) => { const value = sessionStorage.getItem(key(projectId)); return value === null ? undefined : JSON.parse(value); },
    write: (projectId, request) => { if (request) sessionStorage.setItem(key(projectId), JSON.stringify(request)); else sessionStorage.removeItem(key(projectId)); },
  };
}
