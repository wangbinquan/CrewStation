import type { TranscriptIngest } from '../../hooks/useAgentTranscripts';
import { useTranscriptSource } from '../../hooks/useAgentTranscripts';
import { useTaskStream } from '../../hooks/useTaskStream';

/**
 * 一个 Agent 执行环境的任务流（RFC-006：每个 Agent 一个 Pod，它的事件存在执行环境自己的任务下）。
 * 不渲染界面，只把流里的 agent 事件汇入页面的转录；卸载即关闭连接，再挂载时的回放由转录按 seq 去重。
 */
export function AgentExecutionStream({ taskId, ingest }: { readonly taskId: string; readonly ingest: TranscriptIngest }): null {
  const { channel } = useTaskStream(taskId);
  useTranscriptSource(channel, taskId, ingest);
  return null;
}
