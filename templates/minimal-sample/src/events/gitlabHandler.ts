/**
 * 事件订阅处理。cs-events 把 EventDelivery 信封（packages/contracts/events/delivery.ts）经服务域推送到
 * crewstation.yaml `spec.subscriptions[].handlerPath`，只推 prod 活动槽；业务以 2xx 确认，非 2xx 按投递状态机重试。
 * 推送请求头 x-cs-event-type／x-cs-delivery-id／x-cs-delivery-attempt 与信封字段同义，本样例只读信封。
 * 样例把最近 20 条留在内存里供首页展示：多副本时各 Pod 各自一份，真实业务应落库并按 deliveryId 幂等处理。
 */
export const MAX_STORED_EVENTS = 20;

export interface StoredEvent {
  deliveryId: string;
  eventId: string;
  eventType: string;
  occurredAt: string;
  attempt: number;
  traceId: string | null;
  receivedAt: string | null;
  producer: string | null;
  producerProject: string | null;
  /** 本服务接受这次投递的时间。 */
  handledAt: string;
  payload: unknown;
}

export type EventDeliveryParseResult =
  | { ok: true; event: StoredEvent }
  | { ok: false; reason: string };

const REQUIRED_FIELDS = ['deliveryId', 'eventId', 'eventType', 'occurredAt'] as const;

/**
 * 只校验页面与排查要用到的信封字段，不校验业务 payload。
 * 不合格的投递返回 400：平台侧记录失败原因，按状态机重试或转死信。
 */
export function parseEventDelivery(body: unknown, handledAt: Date = new Date()): EventDeliveryParseResult {
  if (!isRecord(body)) return { ok: false, reason: '请求体必须是 EventDelivery JSON 对象' };
  for (const field of REQUIRED_FIELDS) {
    if (!isNonEmptyString(body[field])) return { ok: false, reason: `字段 ${field} 缺失或不是非空字符串` };
  }
  const attempt = body.attempt;
  if (typeof attempt !== 'number' || !Number.isInteger(attempt) || attempt < 1) {
    return { ok: false, reason: '字段 attempt 必须是不小于 1 的整数' };
  }
  const source = isRecord(body.source) ? body.source : {};
  return {
    ok: true,
    event: {
      deliveryId: String(body.deliveryId),
      eventId: String(body.eventId),
      eventType: String(body.eventType),
      occurredAt: String(body.occurredAt),
      attempt,
      traceId: optionalString(body.traceId),
      receivedAt: optionalString(body.receivedAt),
      producer: optionalString(source.producer),
      producerProject: optionalString(source.project),
      handledAt: handledAt.toISOString(),
      payload: body.payload,
    },
  };
}

/** 最近事件的内存环形缓冲：最新的在最前，超出容量丢弃最旧的。 */
export class EventStore {
  private readonly items: StoredEvent[] = [];
  private readonly capacity: number;

  constructor(capacity: number = MAX_STORED_EVENTS) {
    this.capacity = capacity;
  }

  add(event: StoredEvent): void {
    this.items.unshift(event);
    if (this.items.length > this.capacity) this.items.length = this.capacity;
  }

  list(): readonly StoredEvent[] {
    return this.items;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function optionalString(value: unknown): string | null {
  return isNonEmptyString(value) ? value : null;
}
