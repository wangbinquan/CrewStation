import type { Terminal } from '@xterm/xterm';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { openTerminalSession } from '../model/terminalSession';
import { useStreamEvent } from './useStreamEvent';
import type { TaskStreamChannel } from './useTaskStream';

export interface TerminalPaneHandle {
  readonly error: string | undefined;
  /** 容器里的 shell 退出或 TaskRunner 重启后，手动再开一个。 */
  readonly reopen: () => void;
}

/**
 * 终端的生命周期只绑在 channel 与 generation 上，不绑连接状态：
 * 断线重连时 TaskRunner 侧的 PTY 还在，事件按 sinceSeq 回放，重建反而会多开一个 shell。
 */
export function useTerminalPane(containerRef: RefObject<HTMLDivElement | null>, channel: TaskStreamChannel, onActivity: () => void): TerminalPaneHandle {
  const terminalRef = useRef<Terminal | null>(null);
  const terminalIdRef = useRef('');
  const activityRef = useRef(onActivity);
  const [generation, setGeneration] = useState(0);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    activityRef.current = onActivity;
  }, [onActivity]);

  useStreamEvent(
    channel,
    'terminalOutput',
    useCallback((event) => {
      if (event.terminalId === terminalIdRef.current) terminalRef.current?.write(event.data);
    }, []),
  );
  useStreamEvent(
    channel,
    'terminalClosed',
    useCallback((event) => {
      if (event.terminalId !== terminalIdRef.current) return;
      terminalRef.current?.writeln(`\r\n[exit ${event.exitCode ?? '-'}]`);
    }, []),
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const terminalId = `web-${generation}-${Math.random().toString(36).slice(2, 8)}`;
    const session = openTerminalSession({
      container,
      terminalId,
      send: channel.send,
      onInput: () => activityRef.current(),
      onError: setError,
    });
    terminalRef.current = session.terminal;
    terminalIdRef.current = terminalId;
    return () => {
      terminalRef.current = null;
      terminalIdRef.current = '';
      session.dispose();
    };
  }, [containerRef, channel, generation]);

  return { error, reopen: useCallback(() => setGeneration((value) => value + 1), []) };
}
