import { z } from 'zod';
import { DeliveryStateSchema } from '../events/delivery';
import { EventIdSchema, ServiceIdSchema, TraceIdSchema } from '../ids';

export const EventTypeDtoSchema = z.object({ eventType: z.string(), producer: z.string(), producerProject: z.string(), schemaRef: z.string().optional() });

export const SubscriptionDtoSchema = z.object({
  id: z.string(),
  serviceId: ServiceIdSchema,
  eventType: z.string(),
  handlerPath: z.string(),
  state: z.enum(['active', 'paused']),
});

export const DeliveryDtoSchema = z.object({
  id: z.string(),
  eventId: EventIdSchema,
  eventType: z.string(),
  subscriptionId: z.string(),
  state: DeliveryStateSchema,
  attempts: z.number().int().min(0),
  nextAttemptAt: z.iso.datetime().optional(),
  lastError: z.string().optional(),
  traceId: TraceIdSchema,
  deliveredAt: z.iso.datetime().optional(),
});

/** 工作台按项目查投递记录的查询参数。 */
export const ListDeliveriesQuerySchema = z.object({
  state: DeliveryStateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** cs-events 对 EventProducer 投递请求的回执：去重命中时返回已有事件 ID，不产生新投递。 */
export const ProduceResultDtoSchema = z.object({
  eventId: EventIdSchema,
  deduplicated: z.boolean(),
  deliveries: z.number().int().min(0),
});

export type EventTypeDto = z.infer<typeof EventTypeDtoSchema>;
export type ListDeliveriesQuery = z.infer<typeof ListDeliveriesQuerySchema>;
export type ProduceResultDto = z.infer<typeof ProduceResultDtoSchema>;
export type SubscriptionDto = z.infer<typeof SubscriptionDtoSchema>;
export type DeliveryDto = z.infer<typeof DeliveryDtoSchema>;
