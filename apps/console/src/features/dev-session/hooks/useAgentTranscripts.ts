import type { AgentEvent } from '@crewstation/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { appendAgentEvents, isLifecycleEvent } from '../model/agentTranscript';
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

  useEffect(() => {
    lifecycleRef.current = onLifecycle;
  }, [onLifecycle]);

  useStreamEvent(
    channel,
    'agent',
    useCallback((frame) => {
      bufferRef.current.push(frame.event);
      // 只有会改变名册状态的事件才通知外层重读；文本与工具事件太密，不触发。
      if (isLifecycleEvent(frame.event)) lifecycleRef.current(frame.event);
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
