import type { Logger } from '@crewstation/kernel';

export interface Stoppable { stop(): Promise<void> | void }

/** 每个进程共用的优雅退出：SIGTERM/SIGINT 时先停工作器与订阅，再关服务与数据库。 */
export function installShutdown(logger: Logger, steps: Array<{ name: string; stop: () => Promise<void> | void }>): void {
  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logger.info('shutting down', { signal });
    for (const step of steps) {
      try { await step.stop(); } catch (error) { logger.error('shutdown step failed', { step: step.name, error: String(error) }); }
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}
