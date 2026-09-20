import type { AgentPermission, NativeTerminalDto, StartNativeTerminalRequest } from '@crewstation/contracts';
import { isApiClientError } from '@crewstation/api-client';
import { useCallback, useEffect, useRef } from 'react';
import { api } from '../../../../shared/api/client';
import { useApiMutation, useApiQuery } from '../../../../shared/api/useApi';
import type { TaskStreamChannel } from '../useTaskStream';
import type { StreamState } from '../../model/taskStreamSocket';

export function useNativeTerminals(taskId: string, channel: TaskStreamChannel, stream: StreamState, onStarted: (terminal: NativeTerminalDto) => void) {
  const key = ['tasks', taskId, 'native-terminals'];
  const query = useApiQuery(key, () => api.devSession.listNativeTerminals(taskId), { refetchIntervalMs: 10_000 });
  const { refetch } = query;
  const pending = useRef<StartNativeTerminalRequest | null>(null);
  const locked = useRef(false);
  const start = useApiMutation((input: StartNativeTerminalRequest) => api.devSession.startNativeTerminal(taskId, input), { invalidate: [key] });
  const stop = useApiMutation((agentId: string) => api.devSession.stopNativeTerminal(taskId, agentId), { invalidate: [key] });
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = channel.subscribe((event) => {
      if (event.kind !== 'nativeTerminal') return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refetch(), 100);
    });
    return () => { unsubscribe(); if (timer) clearTimeout(timer); };
  }, [channel, refetch]);
  useEffect(() => { if (stream.runnerConnected) void refetch(); }, [stream.runnerConnected, stream.generation, refetch]);
  const launch = useCallback((compute: string, permission: AgentPermission) => {
    if (locked.current) return;
    locked.current = true;
    pending.current ??= { clientRequestId: crypto.randomUUID(), compute: compute ? { kind: 'profile', profileId: compute } : { kind: 'default' }, permission, cols: 80, rows: 24 };
    start.mutate(pending.current, {
      onSuccess: (terminal) => { pending.current = null; onStarted(terminal); },
      onError: (error) => { if (isApiClientError(error) && error.status > 0 && ['validation', 'precondition', 'quota_exceeded', 'forbidden', 'not_found'].includes(error.kind)) pending.current = null; },
      onSettled: () => { locked.current = false; },
    });
  }, [start, onStarted]);
  const rejectedBeforeStart = isApiClientError(start.error) && start.error.status > 0 && ['validation', 'precondition', 'quota_exceeded', 'forbidden', 'not_found'].includes(start.error.kind);
  return { query, start, stop, launch, retryingOriginal: start.isError && !rejectedBeforeStart };
}
