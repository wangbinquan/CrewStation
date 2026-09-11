import type { TaskStreamCommandInput } from '@crewstation/api-client';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { api } from '../../../shared/api/client';
import { resolveStreamEndpoint } from '../model/streamEndpoint';
import { TaskStreamSocket } from '../model/taskStreamSocket';
import type { StreamEventListener, StreamState } from '../model/taskStreamSocket';

/** 面板只拿到收发能力，拿不到连接本身：连接的生命周期只由本 hook 管。 */
export interface TaskStreamChannel {
  readonly send: (input: TaskStreamCommandInput) => Promise<unknown>;
  readonly subscribe: (listener: StreamEventListener) => () => void;
}

export interface TaskStreamHandle {
  readonly state: StreamState;
  readonly channel: TaskStreamChannel;
}

/**
 * 一个开发会话一条 WebSocket。
 * 状态用 useSyncExternalStore 从连接对象读快照：面板订阅的是同一个连接，不会各开一条。
 * channel 的身份只随 taskId 变化，因此订阅事件的 effect 不会被状态刷新反复重建。
 */
export function useTaskStream(taskId: string): TaskStreamHandle {
  const socket = useMemo(
    () => new TaskStreamSocket((sinceSeq) => resolveStreamEndpoint(api.stream.taskStreamUrl(taskId, sinceSeq), window.location.href)),
    [taskId],
  );
  useEffect(() => {
    socket.start();
    return () => {
      socket.stop();
    };
  }, [socket]);
  const state = useSyncExternalStore(socket.subscribeState, socket.getState);
  const channel = useMemo<TaskStreamChannel>(() => ({ send: socket.send, subscribe: socket.subscribeEvents }), [socket]);
  return { state, channel };
}
