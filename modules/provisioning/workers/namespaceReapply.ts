import type { Logger } from '@crewstation/kernel';
import type { ReapplyOutcome } from '../api/moduleApi';

/** `start()` 不能是 async，也不该把异常抛回进程启动；用这个形状包一次一次性任务。 */
export interface StartupTask {
  start(): void;
  stop(): Promise<void>;
}

/**
 * 控制面启动时把命名空间对象重下发一遍（RFC-018）。
 *
 * 只跑一次，不排队也不定时：命名空间对象的形状只在平台换版时变，而换版必然重启控制面。
 * `stop()` 等待在途的那一轮结束，避免关机时留下半下发的命名空间。
 */
export function namespaceReapplyTask(reapply: () => Promise<ReapplyOutcome>, logger: Logger): StartupTask {
  let inFlight: Promise<void> | undefined;
  return {
    start: () => {
      inFlight ??= reapply()
        .then(() => undefined)
        .catch((error: unknown) => { logger.error('namespace reapply aborted', { error: error instanceof Error ? error.message : String(error) }); });
    },
    stop: async () => { await inFlight; },
  };
}
