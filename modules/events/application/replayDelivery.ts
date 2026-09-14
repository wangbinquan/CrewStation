import type { Actor, DeliveryDto } from '@crewstation/contracts';
import { notFound } from '@crewstation/kernel';
import { replayDelivery } from '../domain/delivery';
import type { EventsUseCaseDeps } from './dependencies';
import { deliveryToDto } from './toDto';

/** 负责人重放死信：回到 pending、重新计数并重新入队。 */
export function replayDeliveryUseCase({ uow, projects, clock }: EventsUseCaseDeps) {
  return async (actor: Actor, deliveryId: string): Promise<DeliveryDto> => {
    const delivery = await uow.read.deliveries.getById(deliveryId);
    if (!delivery) throw notFound('投递', deliveryId);
    await projects.authorize(actor, delivery.projectId, 'manage-production-config');
    return uow.run(async (scope) => {
      // 授权期间另一请求可能已重放甚至投递成功；锁内读当前状态，不能用外部旧快照覆盖。
      const current = await scope.deliveries.getById(deliveryId);
      if (!current) throw notFound('投递', deliveryId);
      const replayed = replayDelivery(current, clock.now());
      await scope.deliveries.update(replayed);
      await scope.scheduler.schedule(replayed.id);
      return deliveryToDto(replayed);
    });
  };
}
