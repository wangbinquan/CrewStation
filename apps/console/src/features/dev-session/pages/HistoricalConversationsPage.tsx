import type { ReactElement } from 'react';
import { useSearch } from '@tanstack/react-router';
import { PROJECT_PATHS } from '../../../shared/project/projectPaths';
import { useProjectScope } from '../../../shared/project/ProjectScope';
import { useT } from '../../../shared/lib/useT';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { AgentExecutionStream } from '../components/agents/AgentExecutionStream';
import { AgentsPane } from '../components/agents/AgentsPane';
import { TerminalPane } from '../components/terminal/TerminalPane';
import { useActivityTouch } from '../hooks/useActivityTouch';
import { useAgentTranscripts } from '../hooks/useAgentTranscripts';
import { useAgentSelection, useDevAgents } from '../hooks/useDevAgents';
import { useDevSession } from '../hooks/useDevSession';
import { useTaskStream } from '../hooks/useTaskStream';
import { executionStreamTaskIds } from '../model/agentTranscript';
import { ButtonLink } from '../../../shared/ui/navigation/ButtonLink';

/**
 * 开发会话的流仍服务老 Agent 与终端面板；RFC-006 起每个 Agent 有自己的执行环境，页面按名册为它们各开一条流，
 * 事件汇入同一份转录（已结束的只为选中的 Agent 开，用于回放）。
 */
function ConversationSession({ projectId, taskId, agentId }: { readonly projectId: string; readonly taskId: string; readonly agentId?: string }): ReactElement {
  const { channel } = useTaskStream(taskId);
  const agents = useDevAgents(taskId);
  const { transcripts, ingest } = useAgentTranscripts(channel, taskId, agents.refresh);
  const selection = useAgentSelection(agents.agents, agentId);
  const touch = useActivityTouch(taskId);
  const streams = executionStreamTaskIds(agents.agents, selection.selected?.agentId);
  return <>
    {streams.map((id) => <AgentExecutionStream key={id} taskId={id} ingest={ingest} />)}
    <AgentsPane projectId={projectId} agents={agents} transcripts={transcripts} onActivity={touch} selection={selection} />
    <TerminalPane channel={channel} onActivity={touch} />
  </>;
}
export function HistoricalConversationsPage(): ReactElement {
  const t = useT();
  const { projectId, space } = useProjectScope();
  const agent = useSearch({ strict: false, select: (search) => search.agent });
  const session = useDevSession(projectId);
  return <><PageHeader title={t('devSession.native.history')} description={[t('devSession.native.historyHint')]} />
    <ButtonLink to={PROJECT_PATHS[space].development} params={{ projectId }}>{t('devSession.native.backToCli')}</ButtonLink>
    <QueryStatus isPending={session.isPending} error={session.loadError} />
    {session.session ? <ConversationSession projectId={projectId} key={session.session.taskId} taskId={session.session.taskId} agentId={agent} /> : null}
    {session.missing ? <p>{t('devSession.native.historyMissing')}</p> : null}
  </>;
}
