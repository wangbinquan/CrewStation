import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../../../shared/api/client';
import { initialWorkspaceLayout } from '../../model/layout/workspaceLayout';
import { WorkspaceLayoutStore } from '../../model/layout/workspaceLayoutStore';

/** 同一用户／会话在项目页往返时复用草稿；不同用户的 cache key 完全分离。 */
export function useWorkspaceLayout(taskId: string, userId: string, initialName: string) {
  const client = useQueryClient();
  const store = useMemo(() => {
    const key = ['workspace-layout-store', userId, taskId];
    const saved = client.getQueryData<WorkspaceLayoutStore>(key);
    if (saved) return saved;
    const created = new WorkspaceLayoutStore({ get: () => api.devSession.getWorkspaceLayout(taskId), save: (input) => api.devSession.saveWorkspaceLayout(taskId, input) }, initialWorkspaceLayout(initialName));
    client.setQueryData(key, created);
    return created;
  }, [client, taskId, userId, initialName]);
  useEffect(() => {
    void store.load();
    const focus = () => void store.load();
    window.addEventListener('focus', focus);
    return () => { window.removeEventListener('focus', focus); void store.flush(); };
  }, [store]);
  return { state: useSyncExternalStore(store.subscribe, store.getState), store };
}
