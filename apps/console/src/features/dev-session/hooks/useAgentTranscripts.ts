import type { AgentEvent } from '@crewstation/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { appendAgentEvents, isExecutionEvent, isLifecycleEvent } from '../model/agentTranscript';
import type { TranscriptsByAgent } from '../model/agentTranscript';
import type { TaskStreamChannel } from './useTaskStream';

/** 文本增量一秒可能来几十条，攒一小段再合并重绘，避免每帧一次 setState。 */
const FLUSH_INTERVAL_MS = 80;

/** 把某条任务流（source 是它的 taskId）里的一个 agent 事件汇入转录；seq 是该流的事件序号。 */
export type TranscriptIngest = (source: string, event: AgentEvent, seq: number) => void;

export interface AgentTranscripts {
  readonly transcripts: TranscriptsByAgent;
  /** 执行环境的流（RFC-006：每个 Agent 一个执行环境）经它汇入同一份转录。 */
  readonly ingest: TranscriptIngest;
}

/**
 * Agent 输出按 agentId 分别累积：并行 Agent 之间切换不丢转录。
 * 事件来自开发会话的流（老 Agent）与各 Agent 执行环境的流；每个来源按 seq 去重——执行环境的流卸载后再挂载会从头回放，
 * 已收下的部分不重复进转录。
 */
export function useAgentTranscripts(channel: TaskStreamChannel, source: string, onLifecycle: (event: AgentEvent) => void): AgentTranscripts {
  const [transcripts, setTranscripts] = useState<TranscriptsByAgent>({});
  const bufferRef = useRef<AgentEvent[]>([]);
  const lifecycleRef = useRef(onLifecycle);
  const executingRef = useRef(new Set<string>());
  const appliedRef = useRef(new Map<string, number>());

  useEffect(() => {
    lifecycleRef.current = onLifecycle;
  }, [onLifecycle]);

  const ingest = useCallback<TranscriptIngest>((from, event, seq) => {
    if (seq <= (appliedRef.current.get(from) ?? 0)) return;
    appliedRef.current.set(from, seq);
    bufferRef.current.push(event);
    const lifecycle = isLifecycleEvent(event), executing = isExecutionEvent(event);
    const refresh = lifecycle || executing && !executingRef.current.has(event.agentId);
    if (executing) executingRef.current.add(event.agentId);
    else if (lifecycle) executingRef.current.delete(event.agentId);
    // 等待／权限立即刷新；再次输出只触发一次，名册状态仍由 API 提供。
    if (refresh) lifecycleRef.current(event);
  }, []);

  useTranscriptSource(channel, source, ingest);

  useEffect(() => {
    const timer = setInterval(() => {
      const batch = bufferRef.current;
      if (batch.length === 0) return;
      bufferRef.current = [];
      setTranscripts((current) => appendAgentEvents(current, batch));
    }, FLUSH_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);

  return useMemo(() => ({ transcripts, ingest }), [transcripts, ingest]);
}

/** 订阅一条任务流的 agent 事件并汇入转录；去重在 ingest 里按来源与 seq 做。 */
export function useTranscriptSource(channel: TaskStreamChannel, source: string, ingest: TranscriptIngest): void {
  useEffect(
    () =>
      channel.subscribe((event, seq) => {
        if (event.kind === 'agent') ingest(source, event.event, seq);
      }),
    [channel, source, ingest],
  );
}
