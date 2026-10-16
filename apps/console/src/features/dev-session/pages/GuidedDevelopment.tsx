import type { DevSessionDto } from '@crewstation/contracts';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useT } from '../../../shared/lib/useT';
import { useProjectScope } from '../../../shared/project/ProjectScope';
import { PROJECT_PATHS, RELEASE_PATHS } from '../../../shared/project/projectPaths';
import { Segmented } from '../../../shared/ui/Segmented';
import { StreamStatus } from '../components/StreamStatus';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { ButtonLink } from '../../../shared/ui/navigation/ButtonLink';
import { useTaskStream } from '../hooks/useTaskStream';
import { usePreviewStatus } from '../hooks/usePreviewStatus';
import { useDevAgents } from '../hooks/useDevAgents';
import { useBotEntry } from '../hooks/bot/useBotEntry';
import { useContinuousBot } from '../hooks/bot/useContinuousBot';
import { ContinuousConversation } from '../components/bot/ContinuousConversation';
import { BotHistoryDialog } from '../components/bot/BotHistoryDialog';
import { useAgentTranscripts } from '../hooks/useAgentTranscripts';
import { useActivityTouch } from '../hooks/useActivityTouch';
import { executionStreamTaskIds } from '../model/agentTranscript';
import { AgentExecutionStream } from '../components/agents/AgentExecutionStream';
import { GuidedConversation } from '../components/agents/GuidedConversation';
import { DevelopmentPreview } from '../components/preview/DevelopmentPreview';
import { ConnectionGuide } from '../components/session/ConnectionGuide';
import { SessionStartup, sessionStartupShown } from '../components/session/SessionStartup';
import { SessionCover } from '../components/session/SessionCover';
import { sessionConnection } from '../model/connection/sessionConnection';
import styles from './GuidedDevelopment.module.css';

export function GuidedDevelopment({ session, userId, canDevelop, onRestart, recovery }: { readonly session: DevSessionDto; readonly userId: string; readonly canDevelop: boolean; readonly onRestart?: () => void; readonly recovery: ReactNode }) {
  const t = useT(), { projectId, space } = useProjectScope(), { state, channel, reconnect } = useTaskStream(session.taskId);
  const health = sessionConnection(session, state), ready = health === 'ready' && !sessionStartupShown(session);
  const [enteredAt] = useState(() => Date.now()), [opened, setOpened] = useState(false);
  const [mobilePane, setMobilePane] = useState('conversation'), [historyOpen, setHistoryOpen] = useState(false);
  const bot = useContinuousBot(session.taskId);
  if (ready && !opened) setOpened(true);
  const preview = usePreviewStatus(channel, projectId, state.generation, ready), agents = useDevAgents(session.taskId);
  const selection = useBotEntry(agents.agents, userId, projectId, session.taskId), { transcripts, ingest } = useAgentTranscripts(channel, session.taskId, agents.refresh), touch = useActivityTouch(session.taskId);
  const params = { projectId }, logs = <ButtonLink to={PROJECT_PATHS[space].operations} params={params} search={{ tab: 'logs', source: 'dev-session', taskId: session.taskId }}>{t('devSession.preview.logs')}</ButtonLink>;
  return <div className={styles.page}>
    <header className={styles.context}><div><StreamStatus state={state} sessionState={session.state} compact /><code>{session.branch}</code></div>
      {canDevelop && ready ? <ButtonLink size="small" variant="primary" to={RELEASE_PATHS[space].publish} params={params} search={{ source: 'session' }}>{t('devSession.guided.publish')}</ButtonLink> : null}
    </header>
    {!opened && !ready ? <SessionCover session={session} stream={state} health={health} workspace={{ layout: true, terminals: !agents.isPending, profiles: true }} enteredAt={enteredAt} sessionAt={enteredAt}
      canDevelop={canDevelop} logs={logs} recovery={recovery} onReconnect={reconnect} onRestart={onRestart} onOpenAnyway={() => setOpened(true)} /> : <>
    {sessionStartupShown(session) ? <SessionStartup session={session} canDevelop={canDevelop} onRestart={onRestart} logs={logs} />
      : <ConnectionGuide session={session} stream={state} reconnect={reconnect} logs={logs} />}{recovery}
    {!canDevelop ? <ActionNote tone="neutral">{t('devSession.connection.noPermission')}</ActionNote> : null}
    {[...new Set([...executionStreamTaskIds(agents.agents, selection.selected?.agentId), ...bot.executions.map(execution => execution.executionTaskId)])].map(taskId => <AgentExecutionStream key={taskId} taskId={taskId} ingest={ingest} />)}
    <div className={styles.mobileSwitch}><Segmented label={t('devSession.bot.panel')} value={mobilePane} onChange={setMobilePane}
      items={[{ value: 'conversation', label: t('devSession.bot.modeLabel') }, { value: 'preview', label: t('devSession.native.developmentPreview') }]} /></div>
    <div className={styles.workspace} data-pane={mobilePane}>
      <section aria-label={t('devSession.bot.modeLabel')} className={styles.conversation}><>{selection.selected ? <GuidedConversation projectId={projectId} agents={agents} selection={selection} transcripts={transcripts} ready={ready && canDevelop} onActivity={touch} onHistory={() => setHistoryOpen(true)} />
        : <ContinuousConversation key={session.taskId} projectId={projectId} bot={bot} draftScope={`cs-bot-draft:${userId}:${projectId}:${session.taskId}`} transcripts={transcripts} ready={ready && canDevelop} onHistory={() => setHistoryOpen(true)} onActivity={touch} />}</></section>
      <section aria-label={t('devSession.native.developmentPreview')} className={styles.preview}><DevelopmentPreview preview={preview} previewHost={session.previewHost} connected={ready} readOnly={!canDevelop} logs={logs} /></section>
    </div>
    {historyOpen ? <BotHistoryDialog bot={bot} agents={agents.agents.filter(agent => !agent.botContext)} onSelect={selection.select} onClose={() => setHistoryOpen(false)} /> : null}
    </>}
  </div>;
}
