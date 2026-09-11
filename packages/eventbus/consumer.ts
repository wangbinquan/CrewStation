import type { DomainPayload, DomainTopicName } from '@crewstation/contracts';
import type { Logger } from '@crewstation/kernel';
import { noopLogger } from '@crewstation/kernel';
import type { Database, Transaction } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';

export interface DomainEventRecord<T extends DomainTopicName = DomainTopicName> {
  id: number;
  topic: T;
  payload: DomainPayload<T>;
  occurredAt: Date;
}

export type DomainEventHandler<T extends DomainTopicName> = (event: DomainEventRecord<T>, tx: Transaction) => Promise<void>;

export interface ConsumerOptions {
  db: Database;
  /** `<进程>.<模块>`；同名消费者的多个副本共享游标，靠行锁串行。 */
  consumer: string;
  logger?: Logger;
  pollMs?: number;
  batch?: number;
  maxAttempts?: number;
}

export interface EventConsumer {
  on<T extends DomainTopicName>(topic: T, handler: DomainEventHandler<T>): EventConsumer;
  start(): void;
  stop(): Promise<void>;
  /** 处理一批并推进游标；返回处理的事件数。 */
  runOnce(): Promise<number>;
}

/** 有序、至少一次：游标行锁内读取事件、调用处理器、推进游标；处理器抛错则原地重试，超过次数进入死信。 */
export function createEventConsumer(options: ConsumerOptions): EventConsumer {
  const { db, consumer } = options;
  const logger = (options.logger ?? noopLogger).child({ consumer });
  const pollMs = options.pollMs ?? 1000;
  const batch = options.batch ?? 100;
  const maxAttempts = options.maxAttempts ?? 10;
  const handlers = new Map<string, Array<DomainEventHandler<DomainTopicName>>>();
  const attempts = new Map<number, number>();
  let running = false;
  let active: Promise<void> | undefined;

  const runOnce = (): Promise<number> => db.transaction(async (tx) => {
    await tx.execute(sql`INSERT INTO platform_infra.event_cursors (consumer) VALUES (${consumer}) ON CONFLICT DO NOTHING`);
    const cursorRows = (await tx.execute(sql`SELECT last_event_id FROM platform_infra.event_cursors WHERE consumer = ${consumer} FOR UPDATE`)) as unknown as Array<{ last_event_id: number }>;
    const last = Number(cursorRows[0]?.last_event_id ?? 0);
    const events = (await tx.execute(sql`SELECT id, topic, payload, occurred_at FROM platform_infra.domain_events WHERE id > ${last} ORDER BY id LIMIT ${batch}`)) as unknown as Array<{ id: number; topic: string; payload: unknown; occurred_at: Date }>;
    let processed = 0;
    for (const row of events) {
      const record: DomainEventRecord = { id: Number(row.id), topic: row.topic as DomainTopicName, payload: (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload) as DomainPayload<DomainTopicName>, occurredAt: new Date(row.occurred_at) };
      if (!(await dispatch(record, tx))) break;
      processed += 1;
      await tx.execute(sql`UPDATE platform_infra.event_cursors SET last_event_id = ${record.id}, updated_at = now() WHERE consumer = ${consumer}`);
    }
    return processed;
  });

  const dispatch = async (record: DomainEventRecord, tx: Transaction): Promise<boolean> => {
    try {
      for (const handler of handlers.get(record.topic) ?? []) await handler(record, tx);
      attempts.delete(record.id);
      return true;
    } catch (error) {
      const n = (attempts.get(record.id) ?? 0) + 1;
      attempts.set(record.id, n);
      const message = error instanceof Error ? error.message : String(error);
      if (n < maxAttempts) {
        logger.warn('event handler failed, will retry', { eventId: record.id, topic: record.topic, attempt: n, error: message });
        return false;
      }
      await tx.execute(sql`INSERT INTO platform_infra.event_dead_letters (consumer, event_id, error) VALUES (${consumer}, ${record.id}, ${message}) ON CONFLICT DO NOTHING`);
      logger.error('event dead-lettered', { eventId: record.id, topic: record.topic, error: message });
      attempts.delete(record.id);
      return true;
    }
  };

  const loop = async (): Promise<void> => {
    while (running) {
      let n = 0;
      try { n = await runOnce(); } catch (error) { logger.error('consumer loop error', { error: String(error) }); }
      if (n === 0) await Bun.sleep(pollMs);
    }
  };

  const api: EventConsumer = {
    on: (topic, handler) => {
      handlers.set(topic, [...(handlers.get(topic) ?? []), handler as DomainEventHandler<DomainTopicName>]);
      return api;
    },
    start: () => { if (!running) { running = true; active = loop(); } },
    stop: async () => { running = false; await active; },
    runOnce,
  };
  return api;
}
