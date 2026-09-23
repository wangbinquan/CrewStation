import type { Logger } from '@crewstation/kernel';

/** 路由补投影的节奏：启动后先跑一次（部署时已有的路由进台账），此后每 5 分钟一次；同一时刻只跑一轮。 */
export function routeLedgerResyncWorker(resync: () => Promise<number>, logger: Logger, everyMs = 300_000) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let running: Promise<void> | undefined;
  const once = () => {
    running ??= resync()
      .then((synced) => { if (synced) logger.info('resource ledger routes resynced', { synced }); })
      .catch((error: unknown) => logger.warn('resource ledger route resync failed', { error: String(error) }))
      .finally(() => { running = undefined; });
    return running;
  };
  return {
    start: () => { if (timer) return; void once(); timer = setInterval(() => void once(), everyMs); },
    stop: async () => { if (timer) clearInterval(timer); timer = undefined; await running; },
  };
}
