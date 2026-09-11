import type { DomainPayload, DomainTopicName } from '@crewstation/contracts';
import { DomainPayloadSchemas } from '@crewstation/contracts';
import type { Executor, MigrationSet } from '@crewstation/persistence';
import { readMigrationDir } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';

export const eventbusMigrations: MigrationSet = {
  module: 'platform_infra.eventbus',
  layer: 0,
  files: readMigrationDir(new URL('./migrations', import.meta.url).pathname),
};

/** 在调用方的事务内写入事件日志；载荷先按 contracts 的 Schema 校验。 */
export async function publishDomainEvent<T extends DomainTopicName>(executor: Executor, topic: T, payload: DomainPayload<T>): Promise<number> {
  const parsed = DomainPayloadSchemas[topic].parse(payload) as DomainPayload<T> & { occurredAt: string; traceId?: string };
  const rows = (await executor.execute(sql`
    INSERT INTO platform_infra.domain_events (topic, payload, trace_id, occurred_at)
    VALUES (${topic}, ${parsed as unknown as Record<string, unknown>}, ${parsed.traceId ?? null}, ${parsed.occurredAt})
    RETURNING id`)) as unknown as Array<{ id: number }>;
  return Number(rows[0]?.id);
}
