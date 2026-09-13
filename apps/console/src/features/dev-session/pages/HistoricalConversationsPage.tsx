import type { ReactElement } from 'react';
import { Link, useSearch } from '@tanstack/react-router';
import { PROJECT_PATHS } from '../../../shared/project/projectPaths';
import { useProjectScope } from '../../../shared/project/ProjectScope';
import { useT } from '../../../shared/lib/useT';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { AgentsPane } from '../components/agents/AgentsPane';
import { TerminalPane } from '../components/terminal/TerminalPane';
import { useActivityTouch } from '../hooks/useActivityTouch';
import { useAgentTranscripts } from '../hooks/useAgentTranscripts';
import { useDevAgents } from '../hooks/useDevAgents';
import { useDevSession } from '../hooks/useDevSession';
import { useTaskStream } from '../hooks/useTaskStream';

function ConversationSession({ taskId, agentId }: { readonly taskId: string; readonly agentId?: string }): ReactElement {
  const { channel } = useTaskStream(taskId);
  const agents = useDevAgents(taskId);
  const transcripts = useAgentTranscripts(channel, agents.refresh);
  const touch = useActivityTouch(taskId);
  return <><AgentsPane agents={agents} transcripts={transcripts} onActivity={touch} initialAgentId={agentId} /><TerminalPane channel={channel} onActivity={touch} /></>;
}
export function HistoricalConversationsPage(): ReactElement {
  const t = useT();
  const { projectId, space } = useProjectScope();
  const agent = useSearch({ strict: false, select: (search) => search.agent });
  const session = useDevSession(projectId);
  return <><PageHeader title={t('devSession.native.history')} description={[t('devSession.native.historyHint')]} />
    <Link to={PROJECT_PATHS[space].development} params={{ projectId }}>{t('devSession.native.backToCli')}</Link>
    <QueryStatus isPending={session.isPending} error={session.loadError} />
    {session.session ? <ConversationSession key={session.session.taskId} taskId={session.session.taskId} agentId={agent} /> : null}
    {session.missing ? <p>{t('devSession.native.historyMissing')}</p> : null}
  </>;
}
