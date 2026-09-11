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

export type EventTypeDto = z.infer<typeof EventTypeDtoSchema>;
export type SubscriptionDto = z.infer<typeof SubscriptionDtoSchema>;
export type DeliveryDto = z.infer<typeof DeliveryDtoSchema>;
