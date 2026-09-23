import { z } from 'zod';
import { ResourceIdSchema, EventIdSchema, TraceIdSchema } from '../ids';

/** cs-events 经服务域推送给业务服务 active 槽处理路径的信封；业务以 2xx 确认。 */
export const EventDeliverySchema = z.object({
  deliveryId: ResourceIdSchema,
  eventId: EventIdSchema,
  eventTypeId: ResourceIdSchema,
  eventType: z.string().min(1),
  source: z.object({
    /** 生产方 EventProducer 的 producer 名。 */
    producerId: ResourceIdSchema,
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
export const LegacyProducedEventSchema = z.object({
  eventType: z.string().min(1),
  /** 生产方给出的幂等键，inbox 以 (producer, dedupKey) 去重。 */
  dedupKey: z.string().min(1).max(200),
  occurredAt: z.iso.datetime(),
  /** 已有 traceId 时延续，否则由 cs-events 生成。 */
  traceId: TraceIdSchema.optional(),
  payload: z.unknown(),
});

export const ProducedEventSchema = LegacyProducedEventSchema.omit({ eventType: true }).extend({ eventTypeId: ResourceIdSchema });
export type LegacyProducedEvent = z.infer<typeof LegacyProducedEventSchema>;

/** held：订阅方正式版本维护中且事件开关打开，暂存待补发，不算尝试（RFC-021）。 */
export const DeliveryStateSchema = z.enum(['pending', 'delivering', 'delivered', 'retrying', 'dead', 'held']);

export type EventDelivery = z.infer<typeof EventDeliverySchema>;
export type ProducedEvent = z.infer<typeof ProducedEventSchema>;
export type DeliveryState = z.infer<typeof DeliveryStateSchema>;
