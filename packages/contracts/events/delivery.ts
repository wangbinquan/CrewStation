import { z } from 'zod';
import { EventIdSchema, TraceIdSchema } from '../ids';

/** cs-events 经服务域推送给业务服务 active 槽处理路径的信封；业务以 2xx 确认。 */
export const EventDeliverySchema = z.object({
  deliveryId: z.string().min(1),
  eventId: EventIdSchema,
  eventType: z.string().min(1),
  source: z.object({
    /** 生产方 EventProducer 的 producer 名。 */
    producer: z.string().min(1),
    project: z.string().min(1),
  }),
  occurredAt: z.iso.datetime(),
  receivedAt: z.iso.datetime(),
  traceId: TraceIdSchema,
  attempt: z.number().int().min(1),
  payload: z.unknown(),
});

/** 推送请求头：来源令牌由网关服务域注入，其余由 cs-events 设置。 */
export const EVENT_HEADERS = {
  eventType: 'x-cs-event-type',
  deliveryId: 'x-cs-delivery-id',
  deliveryAttempt: 'x-cs-delivery-attempt',
} as const;

/** EventProducer 向 cs-events 投递原始事件的请求体。 */
export const ProducedEventSchema = z.object({
  eventType: z.string().min(1),
  /** 生产方给出的幂等键，inbox 以 (producer, dedupKey) 去重。 */
  dedupKey: z.string().min(1).max(200),
  occurredAt: z.iso.datetime(),
  /** 已有 traceId 时延续，否则由 cs-events 生成。 */
  traceId: TraceIdSchema.optional(),
  payload: z.unknown(),
});

export const DeliveryStateSchema = z.enum(['pending', 'delivering', 'delivered', 'retrying', 'dead']);

export type EventDelivery = z.infer<typeof EventDeliverySchema>;
export type ProducedEvent = z.infer<typeof ProducedEventSchema>;
export type DeliveryState = z.infer<typeof DeliveryStateSchema>;
