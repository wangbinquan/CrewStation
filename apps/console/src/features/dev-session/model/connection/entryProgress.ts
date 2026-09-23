import type { Translate } from '../../../../shared/lib/useT';
import type { Progress, ProgressStage } from '../../../../shared/ui/progress/stageProgressView';
import type { StreamState } from '../taskStreamSocket';
import type { SessionHealth } from './sessionConnection';

/**
 * 进开发页的四步（2026-09-23 作者裁定）：连接就绪之前整页只有这张步骤清单，不先渲染还不能操作的工作区。
 * 读取会话 → 连接页面通道 → 等待开发环境响应 → 恢复个人布局与 CLI 标签；四步都完成才揭开工作区。
 */
export type EntryStepKind = 'session' | 'channel' | 'environment' | 'workspace';

export interface EntryStep extends ProgressStage { readonly kind: EntryStepKind }

/** 工作区自己的数据是否读完：个人布局、CLI 名册、算力档位。读取失败也算读完——原因在工作区里写明并自动重读。 */
export interface WorkspaceReadiness { readonly layout: boolean; readonly terminals: boolean; readonly profiles: boolean }

export interface EntryInput {
  /** 开始等的时刻（本机时钟）：进页面，或这个会话的工作区挂上。 */
  readonly enteredAt: number;
  /** 会话与当前用户都读到的时刻；还在读时没有。 */
  readonly sessionAt?: number;
  readonly stream?: StreamState;
  readonly health?: SessionHealth;
  readonly workspace?: WorkspaceReadiness;
}

/** 当前一步等了这么久，给「重新连接页面」（通道有过失败时立即给）。 */
export const RECONNECT_OFFER_MS = 10_000;
/** 当前一步等了这么久，给「仍然打开工作区」（2026-09-23 作者裁定：超过 1 分钟）。 */
export const OPEN_ANYWAY_MS = 60_000;

const iso = (at: number) => new Date(at).toISOString();

function step(kind: EntryStepKind, startedAt: number | undefined, endedAt: number | undefined, note: Pick<EntryStep, 'detail' | 'warning'> = {}): EntryStep {
  if (startedAt === undefined) return { kind, state: 'pending' };
  if (endedAt === undefined) return { kind, state: 'running', startedAt: iso(startedAt), ...note };
  const end = Math.max(startedAt, endedAt);
  return { kind, state: 'succeeded', startedAt: iso(startedAt), endedAt: iso(end), durationMs: end - startedAt };
}

function channelNote(stream: StreamState | undefined, t: Translate): Pick<EntryStep, 'detail'> {
  const parts = [stream && stream.attempt > 0 ? t('devSession.stream.attempt', { count: stream.attempt }) : undefined, stream?.error];
  const detail = parts.filter(Boolean).join(' · ');
  return detail ? { detail } : {};
}

/** 开发环境这一步为什么还在等：开始开发或重建没有进度可读时、Runner 正在收尾时、页面已连上而环境没响应时。 */
function environmentNote(health: SessionHealth | undefined, stream: StreamState | undefined, t: Translate): Pick<EntryStep, 'detail' | 'warning'> {
  if (health === 'starting') return { detail: t('devSession.entry.environment.starting') };
  if (health === 'recovering') return { detail: t('devSession.entry.environment.recovering') };
  if (health === 'stopping' && stream?.runnerState) return { warning: t(`devSession.runnerState.${stream.runnerState}`) };
  if (health === 'unknown') return { detail: t('devSession.entry.environment.unknown') };
  return {};
}

function workspaceNote(workspace: WorkspaceReadiness | undefined, t: Translate): Pick<EntryStep, 'detail'> {
  if (!workspace) return {};
  const pending = !workspace.layout ? 'devSession.native.layoutLoading' : !workspace.terminals ? 'devSession.entry.workspace.terminals' : !workspace.profiles ? 'devSession.native.loadingProfiles' : undefined;
  return pending ? { detail: t(pending) } : {};
}

/** 按当前状态排出四步；每一步从上一步完成的那一刻算起，页面通道断开重连时回到第二步。 */
export function entryProgress(input: EntryInput, t: Translate): Progress<EntryStep> {
  const { enteredAt, sessionAt, stream, health, workspace } = input;
  const opened = sessionAt === undefined || stream?.status !== 'open' ? undefined : stream.openedAt ?? sessionAt;
  const ready = opened !== undefined && health === 'ready' ? Math.max(opened, stream?.runnerAt ?? opened) : undefined;
  const settled = ready !== undefined && workspace?.layout && workspace.terminals && workspace.profiles ? ready : undefined;
  return {
    state: 'running',
    startedAt: iso(enteredAt),
    stages: [
      step('session', enteredAt, sessionAt),
      step('channel', sessionAt, opened, channelNote(stream, t)),
      step('environment', opened, ready, environmentNote(health, stream, t)),
      step('workspace', ready, settled, workspaceNote(workspace, t)),
    ],
  };
}
