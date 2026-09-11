import type { RunnerEvent } from '@crewstation/contracts';
import { useEffect, useRef } from 'react';
import type { TaskStreamChannel } from './useTaskStream';

type EventOfKind<K extends RunnerEvent['kind']> = Extract<RunnerEvent, { kind: K }>;

/**
 * 按 kind 订阅事件。
 * 处理函数存在 ref 里：每次渲染换新函数也不会退订重订，否则高频事件会把订阅表抖散。
 */
export function useStreamEvent<K extends RunnerEvent['kind']>(channel: TaskStreamChannel, kind: K, handler: (event: EventOfKind<K>) => void): void {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);
  useEffect(
    () =>
      channel.subscribe((event) => {
        if (event.kind === kind) handlerRef.current(event as EventOfKind<K>);
      }),
    [channel, kind],
  );
}
