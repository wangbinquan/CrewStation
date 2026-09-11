import type { ReleaseDevSessionResult } from '@crewstation/api-client';
import type { DevSessionDto } from '@crewstation/contracts';
import type { UseMutationResult } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import type { ApiClientError } from '../../../shared/api/useApi';
import { DataBindingPane } from '../components/DataBindingPane';
import { PublishPane } from '../components/PublishPane';
import { SessionCard } from '../components/SessionCard';
import { AgentsPane } from '../components/agents/AgentsPane';
import { EditorPane } from '../components/editor/EditorPane';
import { PreviewPane } from '../components/preview/PreviewPane';
import { TerminalPane } from '../components/terminal/TerminalPane';
import { useActivityTouch } from '../hooks/useActivityTouch';
import { useAgentTranscripts } from '../hooks/useAgentTranscripts';
import { useDataBindings } from '../hooks/useDataBindings';
import { useDevAgents } from '../hooks/useDevAgents';
import { useFileEditor } from '../hooks/useFileEditor';
import { usePreviewStatus } from '../hooks/usePreviewStatus';
import { usePublishForm } from '../hooks/usePublishForm';
import { useTaskStream } from '../hooks/useTaskStream';
import { useWorkspaceTree } from '../hooks/useWorkspaceTree';
import type { SessionAccess } from '../model/sessionAccess';
import styles from './DevSessionWorkbench.module.css';

export interface DevSessionWorkbenchProps {
  readonly projectId: string;
  readonly session: DevSessionDto;
  readonly access: SessionAccess;
  readonly serviceId: string | undefined;
  readonly release: UseMutationResult<ReleaseDevSessionResult, ApiClientError, boolean>;
}

/**
 * 有会话时的工作区：一条任务流供四个面板共用，外加发布与数据绑定。
 * 所有面板都只拿 channel，不各自开连接。
 */
export function DevSessionWorkbench({ projectId, session, access, serviceId, release }: DevSessionWorkbenchProps): ReactElement {
  const taskId = session.taskId;
  const { state, channel } = useTaskStream(taskId);
  const touch = useActivityTouch(taskId);
  const agents = useDevAgents(taskId);
  const transcripts = useAgentTranscripts(channel, agents.refresh);
  const tree = useWorkspaceTree(channel);
  const editor = useFileEditor(channel);
  const preview = usePreviewStatus(channel);
  const publish = usePublishForm(projectId);
  const data = useDataBindings(projectId, taskId, serviceId);
  return (
    <>
      <SessionCard session={session} stream={state} access={access} release={release} />
      <div className={styles.grid}>
        <AgentsPane agents={agents} transcripts={transcripts} onActivity={touch} />
        <TerminalPane channel={channel} onActivity={touch} />
        <EditorPane tree={tree} editor={editor} />
        <PreviewPane preview={preview} previewHost={session.previewHost} />
        <PublishPane publish={publish} />
        <DataBindingPane data={data} />
      </div>
    </>
  );
}
