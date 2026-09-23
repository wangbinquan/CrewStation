import type { ServiceId } from '@crewstation/contracts';
import { releaseHeldDelivery } from '../domain/delivery';
import type { EventsUseCaseDeps } from './dependencies';

/** 一轮最多补发多少条；更多的留给下一轮，仍按接收顺序。 */
const RELEASE_BATCH = 500;

/**
 * 补发维护暂存的投递（RFC-021 B5）：只处理当前不再暂存的服务；按事件接收顺序逐条回到 pending 并入队，
 * `runAt` 依次加 1 毫秒——队列按 run_at 认领，于是按原顺序进入投递。之后的并发、退避与死信规则不变。
 * 某一条入队失败（上一项队列任务尚未结束）只跳过它，留给下一轮。
 */
export function releaseHeldUseCase({ uow, hold, clock }: EventsUseCaseDeps) {
  return async (serviceId?: ServiceId): Promise<number> => {
    const held = await uow.read.deliveries.listHeld(serviceId, RELEASE_BATCH);
    const base = clock.now().getTime();
    let released = 0;
    for (const service of [...new Set(held.map((d) => d.serviceId))]) {
      if (await hold.holds(service)) continue;
      for (const delivery of held.filter((d) => d.serviceId === service)) {
        const at = new Date(base + released);
        const ok = await uow.run(async (scope) => {
          const fresh = await scope.deliveries.getById(delivery.id);
          if (fresh?.state !== 'held') return false;
          await scope.deliveries.update(releaseHeldDelivery(fresh, at));
          await scope.scheduler.schedule(fresh.id, at);
          return true;
        }).catch(() => false);
        if (ok) released += 1;
      }
    }
    return released;
  };
}
