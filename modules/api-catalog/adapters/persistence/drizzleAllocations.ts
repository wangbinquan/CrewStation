import type { Executor } from '@crewstation/persistence';
import { conflict } from '@crewstation/kernel';
import { and, eq, sql } from 'drizzle-orm';
import type { ApiAllocations } from '../../ports/allocations';
import { allocationReceipts } from './allocationTable';

export function drizzleApiAllocations(db: Executor): ApiAllocations {
  return {
    bindService: async (serviceId, projectId) => { await db.execute(sql`SELECT api_catalog.bind_service_owner(${serviceId},${projectId})`); },
    get: async (serviceId, operationId) => (await db.select().from(allocationReceipts).where(and(eq(allocationReceipts.serviceId, serviceId), eq(allocationReceipts.operationId, operationId))))[0]?.body,
    save: async (serviceId, operationId, body) => { await db.insert(allocationReceipts).values({ operationId, serviceId, body }); },
    lock: async (serviceId) => { const rows = await db.execute<{ acquired: boolean }>(sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${`api-allocations:${serviceId}`}, 0)) AS acquired`); if (!rows[0]?.acquired) throw conflict('接口授权正在更新，请重试'); },
  };
}
