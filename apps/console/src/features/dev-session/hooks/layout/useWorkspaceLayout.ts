import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../../../shared/api/client';
import { useT } from '../../../../shared/lib/useT';
import { newDraftResourceId } from '@crewstation/api-client';
import { normalizeGroups } from '../../model/layout/terminalGroups';
import { initialWorkspaceLayout } from '../../model/layout/workspaceLayout';
import { LAYOUT_REQUEST_TIMEOUT_MS, WorkspaceLayoutStore } from '../../model/layout/workspaceLayoutStore';

/** 同一用户／会话在项目页往返时复用草稿；不同用户的 cache key 完全分离。 */
export function useWorkspaceLayout(taskId: string, userId: string, initialName: string) {
  const client = useQueryClient(), t = useT();
  const store = useMemo(() => {
    const key = ['workspace-layout-store', userId, taskId];
    const saved = client.getQueryData<WorkspaceLayoutStore>(key);
    if (saved) return saved;
    const created = new WorkspaceLayoutStore({ get: (signal) => api.devSession.getWorkspaceLayout(taskId, { signal }), save: (input, signal) => api.devSession.saveWorkspaceLayout(taskId, input, { signal }) },
      initialWorkspaceLayout(initialName), (layout) => normalizeGroups(layout, newDraftResourceId), { ms: LAYOUT_REQUEST_TIMEOUT_MS, message: t('devSession.native.layoutTimeout', { seconds: LAYOUT_REQUEST_TIMEOUT_MS / 1000 }) });
    client.setQueryData(key, created);
    return created;
  }, [client, taskId, userId, initialName, t]);
  useEffect(() => {
    void store.load();
    const focus = () => void store.load();
    window.addEventListener('focus', focus);
    return () => { window.removeEventListener('focus', focus); void store.flush(); };
  }, [store]);
  return { state: useSyncExternalStore(store.subscribe, store.getState), store };
}
