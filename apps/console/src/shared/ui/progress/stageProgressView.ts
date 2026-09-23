import type { StartupStageState } from '@crewstation/contracts';
import { currentStage } from '@crewstation/contracts';
import type { Translate } from '../../lib/useT';

/** 公共步骤条能画的一段：启动进度（RFC-022）的段与档位测试的段都满足。 */
export interface ProgressStage {
  readonly kind: string;
  readonly state: StartupStageState;
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly durationMs?: number;
  readonly subject?: string;
  readonly count?: { readonly done: number; readonly total: number };
  readonly detail?: string;
  readonly warning?: string;
  readonly error?: { readonly code: string; readonly message: string };
  readonly logTail?: string;
}

export interface Progress<S extends ProgressStage = ProgressStage> {
  readonly state: 'running' | 'ready' | 'failed' | 'cancelled';
  readonly stages: readonly S[];
  readonly startedAt: string;
  readonly endedAt?: string;
  /** 服务器给出这份进度的时刻；没有时按本机时钟计时。 */
  readonly observedAt?: string;
  /** 本机收到这份进度的时刻（取数时由 stampReceived 记下），与 observedAt 一起算出时钟偏差。 */
  readonly receivedAt?: number;
}

/** 取数时记下收到的时刻（不在渲染里取时间）：进行中的计时据此校正本机时钟偏差。 */
export function stampReceived<P extends { readonly observedAt?: string }>(progress: P | undefined, receivedAt: number): (P & { readonly receivedAt: number }) | undefined {
  return progress ? { ...progress, receivedAt } : undefined;
}

/** 失败的段要等回收流程补上日志，比「失败」晚几秒到：这段时间里页面仍按启动中的节奏读，展开的日志尽快出现。 */
export const FAILURE_LOG_WAIT_MS = 20_000;

/** 刚失败、失败段还没有日志，且失败不到 FAILURE_LOG_WAIT_MS（都按服务器时间比，observedAt 每次读取都会前进）。 */
export function awaitingFailureLog(progress: Progress | undefined): boolean {
  if (progress?.state !== 'failed') return false;
  const failed = progress.stages.find((stage) => stage.state === 'failed');
  if (!failed || failed.logTail) return false;
  return Date.parse(progress.observedAt ?? '') - Date.parse(failed.endedAt ?? progress.endedAt ?? '') < FAILURE_LOG_WAIT_MS;
}

/** 取数间隔（RFC-022）：有进行中的，或刚失败、日志还没补上的，用 busyMs；其余用 idleMs。 */
export function progressPollMs(progresses: readonly (Progress | undefined)[], busyMs: number, idleMs: number): number {
  return progresses.some((progress) => progress?.state === 'running' || awaitingFailureLog(progress)) ? busyMs : idleMs;
}

/** 服务器时钟减本机时钟（收到这份进度的那一刻）：进行中的计时用本机时间加上它，不受本机时钟快慢影响。 */
export function clockSkew(observedAt: string | undefined, receivedAt: number): number {
  const server = observedAt ? Date.parse(observedAt) : Number.NaN;
  return Number.isNaN(server) ? 0 : server - receivedAt;
}

/** 一段的用时：已结束的用后端算好的；进行中的按校正后的现在算；没开始的没有。 */
export function stageElapsed(stage: ProgressStage, now: number, skew: number): number | undefined {
  if (stage.durationMs !== undefined) return stage.durationMs;
  if (stage.state === 'running' && stage.startedAt) return Math.max(0, now + skew - Date.parse(stage.startedAt));
  if (stage.startedAt && stage.endedAt) return Math.max(0, Date.parse(stage.endedAt) - Date.parse(stage.startedAt));
  return undefined;
}

/** 整个过程到现在（结束了就到结束）的用时。 */
export function totalElapsed(progress: Progress, now: number, skew: number): number {
  const end = progress.endedAt ? Date.parse(progress.endedAt) : now + skew;
  return Math.max(0, end - Date.parse(progress.startedAt));
}

/** 当前段在第几段（从 1 起）与一共几段；跳过的段也算在总数里，和步骤条上看到的行数一致。 */
export function stagePosition<S extends ProgressStage>(progress: Progress<S>): { index: number; total: number; stage?: S } {
  const stage = currentStage(progress.stages);
  return { index: stage ? progress.stages.indexOf(stage) + 1 : 0, total: progress.stages.length, ...(stage ? { stage } : {}) };
}

/** 用时的写法：10 秒内保留一位小数，一分钟内取整秒，更长写几分几秒。 */
export function formatDuration(t: Translate, ms: number): string {
  if (ms < 10_000) return t('ui.progress.duration.seconds', { value: (Math.floor(ms / 100) / 10).toFixed(1) });
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return t('ui.progress.duration.seconds', { value: String(seconds) });
  return t('ui.progress.duration.minutes', { minutes: String(Math.floor(seconds / 60)), seconds: String(seconds % 60).padStart(2, '0') });
}

/** 启动进度各段的名字（作者裁定的原话）；带参数的两段：检出的分支、启动前步骤的 x/y。 */
export function stageLabel(t: Translate, stage: ProgressStage): string {
  if (stage.kind === 'checkout') return t('ui.progress.stage.checkout', { branch: stage.subject ?? '' });
  if (stage.kind === 'prepare') return stage.count ? t('ui.progress.stage.prepare', { done: String(stage.count.done), total: String(stage.count.total) }) : t('ui.progress.stage.prepareUncounted');
  return t(`ui.progress.stage.${stage.kind}`);
}
