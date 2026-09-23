import type { Actor, DeliveryDto, EventTypeDto, ProjectId, SubscriptionDto } from '@crewstation/contracts';
import type { DeliveryFilter, TraceDeliveryDto, TraceKeyDto, TraceKeyPage } from '../api/moduleApi';
import type { EventsUseCaseDeps } from './dependencies';
import { deliveryToDto, eventTypeToDto, subscriptionToDto } from './toDto';

const DEFAULT_LIMIT = 50;

/** 读侧：事件类型目录对所有登录用户开放；订阅与投递记录要求对项目可见。 */
export function eventQueryUseCases({ uow, projects }: EventsUseCaseDeps) {
  return {
    listEventTypes: async (_actor: Actor): Promise<EventTypeDto[]> => (await uow.read.eventTypes.list()).map(eventTypeToDto),
    listSubscriptions: async (actor: Actor, projectId: ProjectId): Promise<SubscriptionDto[]> => {
      await projects.authorize(actor, projectId, 'view');
      return (await uow.read.subscriptions.listByProject(projectId)).map(subscriptionToDto);
    },
    listDeliveries: async (actor: Actor, projectId: ProjectId, filter: DeliveryFilter = {}): Promise<DeliveryDto[]> => {
      await projects.authorize(actor, projectId, 'view');
      return (await uow.read.deliveries.listByProject(projectId, filter.state, filter.limit ?? DEFAULT_LIMIT)).map(deliveryToDto);
    },
    // 调用链（Design §14）的内部读取：observability 已按项目校验过可见性。
    traceKeys: (projectId: ProjectId, page: TraceKeyPage): Promise<TraceKeyDto[]> => uow.read.deliveries.traceKeys(projectId, page),
    activeTraceIds: (projectId: ProjectId, since: string): Promise<string[]> => uow.read.deliveries.activeTraceIds(projectId, since),
    listTraceDeliveries: async (projectId: ProjectId, traceIds: readonly string[]): Promise<TraceDeliveryDto[]> =>
      (await uow.read.deliveries.listByProjectTraces(projectId, traceIds)).map((d) => ({ ...deliveryToDto(d), createdAt: d.createdAt.toISOString(), updatedAt: d.updatedAt.toISOString() })),
  };
}
