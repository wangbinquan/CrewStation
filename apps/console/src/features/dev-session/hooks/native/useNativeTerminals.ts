import type { AgentPermission, NativeTerminalDto, StartNativeTerminalRequest } from '@crewstation/contracts';
import { isApiClientError } from '@crewstation/api-client';
import { useCallback, useEffect, useRef } from 'react';
import { api } from '../../../../shared/api/client';
import { useApiMutation, useApiQuery } from '../../../../shared/api/useApi';
import type { TaskStreamChannel } from '../useTaskStream';
import type { StreamState } from '../../model/taskStreamSocket';
import { creatorClaims } from '../../model/native/creatorClaims';
import { progressPollMs, stampReceived } from '../../../../shared/ui/progress/stageProgressView';

/** 有 CLI 在启动时每秒读一次名册（RFC-022 B9）：执行容器连上之前没有任何推送，阶段靠读；刚失败、日志还没补上的也每秒；其余时候 10 秒。 */
export const STARTUP_POLL_MS = 1_000;
const ROSTER_POLL_MS = 10_000;

/** onStarted 的第二个参数：这次是重试，新 CLI 要原位替换的旧标签（RFC-022 Q2）。 */
export function useNativeTerminals(taskId: string, channel: TaskStreamChannel, stream: StreamState, onStarted: (terminal: NativeTerminalDto, replaces?: string) => void) {
  const key = ['tasks', taskId, 'native-terminals'];
  const query = useApiQuery(key, async () => {
    const list = await api.devSession.listNativeTerminals(taskId), receivedAt = Date.now();
    return { ...list, items: list.items.map((item) => (item.startup ? { ...item, startup: stampReceived(item.startup, receivedAt)! } : item)) };
  }, { refetchIntervalMs: (data) => progressPollMs(data?.items.map((item) => item.startup) ?? [], STARTUP_POLL_MS, ROSTER_POLL_MS) });
  const { refetch } = query;
  const pending = useRef<{ request: StartNativeTerminalRequest; replaces?: string } | null>(null);
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
  const launch = useCallback((compute: string, permission: AgentPermission, replaces?: string) => {
    if (locked.current) return;
    locked.current = true;
    pending.current ??= { request: { clientRequestId: crypto.randomUUID(), compute: compute ? { kind: 'profile', profileId: compute } : { kind: 'default' }, permission, cols: 80, rows: 24 }, ...(replaces ? { replaces } : {}) };
    const attempt = pending.current;
    start.mutate(attempt.request, {
      // 本窗口创建的 CLI：进程拉起时自动替创建者取得输入控制（RFC-022 D1）。
      onSuccess: (terminal) => { pending.current = null; creatorClaims.remember(terminal.clientRequestId); onStarted(terminal, attempt.replaces); },
      onError: (error) => { if (isApiClientError(error) && error.status > 0 && ['validation', 'precondition', 'quota_exceeded', 'forbidden', 'not_found'].includes(error.kind)) pending.current = null; },
      onSettled: () => { locked.current = false; },
    });
  }, [start, onStarted]);
  const rejectedBeforeStart = isApiClientError(start.error) && start.error.status > 0 && ['validation', 'precondition', 'quota_exceeded', 'forbidden', 'not_found'].includes(start.error.kind);
  return { query, start, stop, launch, retryingOriginal: start.isError && !rejectedBeforeStart };
}
