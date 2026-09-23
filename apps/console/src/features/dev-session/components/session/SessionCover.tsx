import type { DevSessionDto } from '@crewstation/contracts';
import type { ReactElement, ReactNode } from 'react';
import { useT } from '../../../../shared/lib/useT';
import { entryProgress } from '../../model/connection/entryProgress';
import type { WorkspaceReadiness } from '../../model/connection/entryProgress';
import type { SessionHealth } from '../../model/connection/sessionConnection';
import type { StreamState } from '../../model/taskStreamSocket';
import { EntrySteps, SessionBlocked, SessionEntryFrame } from './SessionEntry';
import { SessionStartup, sessionStartupShown } from './SessionStartup';

export interface SessionCoverProps {
  readonly session: DevSessionDto; readonly stream: StreamState; readonly health: SessionHealth; readonly workspace: WorkspaceReadiness;
  /** 开始等的时刻与会话读到的时刻（本机时钟），步骤清单据此计时。 */
  readonly enteredAt: number; readonly sessionAt: number;
  readonly canDevelop: boolean; readonly logs: ReactNode;
  /** 保卷恢复（检查并恢复原工作树／从远端另建工作树）；没有开发权限或不需要恢复时为空。 */
  readonly recovery: ReactNode;
  readonly onReconnect: () => void; readonly onRestart?: () => void; readonly onOpenAnyway: () => void;
}

/**
 * 工作区揭开之前整页显示什么（2026-09-23 作者裁定）：开始开发或重建时是启动步骤条（RFC-022，从 CLI 区中间移到整页中间），
 * 失败或要处理时是状态卡加恢复入口，其余是进页的步骤清单。揭开之后再断线、失败或重建，回到工作区里原有的提示与步骤条。
 */
export function SessionCover(props: SessionCoverProps): ReactElement {
  const t = useT(), { session, stream, health } = props;
  // 恢复卡始终排在第二位：状态卡 → 步骤清单 → 启动步骤条来回切换时它不重挂，已提交的恢复请求、回执与重试都还在。
  // 失败在等待连接或重建本身时，「重试」原本打开会话面板里的恢复；面板还没出现，恢复卡就在步骤条下面。
  const recovery = health === 'releasing' ? null : props.recovery;
  if (sessionStartupShown(session)) {
    return <SessionEntryFrame busy={session.startup?.state !== 'failed'}>
      <SessionStartup session={session} canDevelop={props.canDevelop} {...(props.onRestart ? { onRestart: props.onRestart } : {})} logs={props.logs} />
      {recovery}
    </SessionEntryFrame>;
  }
  if (health === 'failed' || health === 'protocol' || health === 'releasing') {
    return <SessionEntryFrame busy={health === 'releasing'}><SessionBlocked status={health} session={session} logs={props.logs} />{recovery}</SessionEntryFrame>;
  }
  const progress = entryProgress({ enteredAt: props.enteredAt, sessionAt: props.sessionAt, stream, health, workspace: props.workspace }, t);
  return <SessionEntryFrame busy>
    <EntrySteps progress={progress} branch={session.branch} logs={props.logs} channelTrouble={stream.attempt > 0 || stream.error !== undefined}
      onReconnect={props.onReconnect} onOpenAnyway={props.onOpenAnyway} />
    {recovery}
  </SessionEntryFrame>;
}
