import type { AgentEvent } from '@crewstation/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { appendAgentEvents, isExecutionEvent, isLifecycleEvent } from '../model/agentTranscript';
import type { TranscriptsByAgent } from '../model/agentTranscript';
import { useStreamEvent } from './useStreamEvent';
import type { TaskStreamChannel } from './useTaskStream';

/** 文本增量一秒可能来几十条，攒一小段再合并重绘，避免每帧一次 setState。 */
const FLUSH_INTERVAL_MS = 80;

/** Agent 输出按 agentId 分别累积：并行 Agent 之间切换不丢转录。 */
export function useAgentTranscripts(channel: TaskStreamChannel, onLifecycle: (event: AgentEvent) => void): TranscriptsByAgent {
  const [transcripts, setTranscripts] = useState<TranscriptsByAgent>({});
  const bufferRef = useRef<AgentEvent[]>([]);
  const lifecycleRef = useRef(onLifecycle);
  const executingRef = useRef(new Set<string>());

  useEffect(() => {
    lifecycleRef.current = onLifecycle;
  }, [onLifecycle]);

  useStreamEvent(
    channel,
    'agent',
    useCallback((frame) => {
      bufferRef.current.push(frame.event);
      const lifecycle = isLifecycleEvent(frame.event), executing = isExecutionEvent(frame.event);
      const refresh = lifecycle || executing && !executingRef.current.has(frame.event.agentId);
      if (executing) executingRef.current.add(frame.event.agentId);
      else if (lifecycle) executingRef.current.delete(frame.event.agentId);
      // 等待／权限立即刷新；再次输出只触发一次，名册状态仍由 API 提供。
      if (refresh) lifecycleRef.current(frame.event);
    }, []),
  );

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

  return transcripts;
}
