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
 * 每个执行身份一条 WebSocket；旧 CLI 共享父工作区，新 CLI 使用独立执行身份。
 * 状态用 useSyncExternalStore 从连接对象读快照：面板订阅的是同一个连接，不会各开一条。
 * channel 的身份只随 taskId 变化，因此订阅事件的 effect 不会被状态刷新反复重建。
 */
export interface TaskStreamOptions {
  /** 'tail'：首次打开只回放最近一页（终端靠快照恢复，名册与动态另有查询）；省略则从头回放，历史对话页据此重建转录。 */
  readonly replay?: 'tail';
}

export function useTaskStream(taskId: string, enabled = true, options: TaskStreamOptions = {}): TaskStreamHandle {
  const replay = options.replay;
  const socket = useMemo(
    () => new TaskStreamSocket((sinceSeq) => resolveStreamEndpoint(api.stream.taskStreamUrl(taskId, sinceSeq, sinceSeq === 0 ? replay : undefined), window.location.href)),
    [taskId, replay],
  );
  useEffect(() => {
    if (enabled) socket.start();
    return () => {
      socket.stop();
    };
  }, [socket, enabled]);
  const state = useSyncExternalStore(socket.subscribeState, socket.getState);
  const channel = useMemo<TaskStreamChannel>(() => ({ send: socket.send, subscribe: socket.subscribeEvents }), [socket]);
  return { state, channel };
}
