import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { api } from '../api/client';
import { queryKeys } from '../api/queryKeys';
import { useApiQuery } from '../api/useApi';
import { AgentActivityStore } from './agentActivityStore';
import type { ActivitySnapshot } from './agentActivityStore';

const context = createContext<AgentActivityStore | null>(null);
const EMPTY: ActivitySnapshot = { tasks: [], notice: null, limited: false };
const subscribeEmpty = () => () => {};
const snapshotEmpty = () => EMPTY;

export function AgentActivityProvider({ children }: { readonly children: ReactNode }): ReactElement {
  const me = useApiQuery(queryKeys.me(), () => api.me.get());
  const userId = me.error ? undefined : me.data?.id;
  const store = useMemo(() => userId ? new AgentActivityStore({
    page: (taskId, before) => api.devSession.getAgentActivity(taskId, { limit: 50, unread: true, ...(before === undefined ? {} : { before }) }),
    terminals: (taskId) => api.devSession.listNativeTerminals(taskId),
    read: (taskId, input) => api.devSession.readAgentActivity(taskId, input),
  }) : null, [userId]);
  useEffect(() => {
    if (!store) return;
    const refresh = () => { if (document.visibilityState !== 'hidden') for (const task of store.getSnapshot().tasks) void store.refresh(task.taskId); };
    const timer = setInterval(refresh, 5000);
    document.addEventListener('visibilitychange', refresh); window.addEventListener('focus', refresh);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('focus', refresh); store.dispose(); };
  }, [store]);
  return <context.Provider value={store}>{children}</context.Provider>;
}

export function useAgentActivity() {
  const store = useContext(context);
  const snapshot = useSyncExternalStore(store?.subscribe ?? subscribeEmpty, store?.getSnapshot ?? snapshotEmpty, snapshotEmpty);
  return { store, snapshot };
}
