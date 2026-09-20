import type { HttpMethod, ManifestKind, OpenPolicy, ProjectId, ServiceId } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import { eq } from 'drizzle-orm';
import type { ApiOperation, CatalogEntryState } from '../../domain/apiOperation';
import type { ApiProxy } from '../../domain/apiProxy';
import type { ApiOperationRepository, ApiProxyRepository } from '../../ports/repositories';
import { operations, proxies } from './tables';

export function drizzleProxyRepository(db: Executor): ApiProxyRepository {
  return {
    upsert: async (proxy) => {
      await db.insert(proxies).values(toProxyRow(proxy)).onConflictDoUpdate({ target: proxies.id, set: toProxyRow(proxy) });
    },
    getByCode: async (name) => {
      const row = (await db.select().from(proxies).where(eq(proxies.proxy, name)))[0];
      return row ? toProxy(row) : undefined;
    },
    getById: async (id) => { const row = (await db.select().from(proxies).where(eq(proxies.id, id)))[0]; return row ? toProxy(row) : undefined; },
    listByService: async (serviceId) => (await db.select().from(proxies).where(eq(proxies.serviceId, serviceId)).orderBy(proxies.proxy)).map(toProxy),
    list: async () => (await db.select().from(proxies).orderBy(proxies.proxy)).map(toProxy),
  };
}

export function drizzleOperationRepository(db: Executor): ApiOperationRepository {
  return {
    listByProxy: async (proxy) => (await db.select().from(operations).where(eq(operations.proxyId, proxy)).orderBy(operations.id)).map(toOperation),
    listActive: async () => (await db.select().from(operations).where(eq(operations.state, 'active')).orderBy(operations.id)).map(toOperation),
    getById: async (key) => {
      const row = (await db.select().from(operations).where(eq(operations.id, key)))[0];
      return row ? toOperation(row) : undefined;
    },
    upsertMany: async (ops) => {
      for (const op of ops) {
        await db.insert(operations).values(toOperationRow(op)).onConflictDoUpdate({ target: operations.id, set: toOperationRow(op) });
      }
    },
    update: async (op) => { await db.update(operations).set(toOperationRow(op)).where(eq(operations.id, op.id)); },
  };
}

function toProxy(row: typeof proxies.$inferSelect): ApiProxy {
  return {
    id: row.id, name: row.name, proxy: row.proxy, projectId: row.projectId as ProjectId, serviceId: row.serviceId as ServiceId, kind: row.kind as ManifestKind,
    ...(row.upstreamConnection ? { upstreamConnection: row.upstreamConnection } : {}),
    document: row.document, state: row.state as CatalogEntryState, updatedAt: row.updatedAt,
  };
}

function toProxyRow(proxy: ApiProxy): typeof proxies.$inferInsert {
  return {
    id: proxy.id, name: proxy.name, proxy: proxy.proxy, projectId: proxy.projectId, serviceId: proxy.serviceId, kind: proxy.kind,
    upstreamConnection: proxy.upstreamConnection ?? null, document: proxy.document, state: proxy.state, updatedAt: proxy.updatedAt,
  };
}

function toOperation(row: typeof operations.$inferSelect): ApiOperation {
  return {
    id: row.id, proxyId: row.proxyId, proxy: row.proxy, method: row.method as HttpMethod, path: row.path,
    ...(row.summary === null ? {} : { summary: row.summary }),
    openPolicy: row.openPolicy as OpenPolicy,
    ...(row.resourceNote === null ? {} : { resourceNote: row.resourceNote }),
    state: row.state as CatalogEntryState, updatedAt: row.updatedAt,
  };
}

function toOperationRow(op: ApiOperation): typeof operations.$inferInsert {
  return {
    id: op.id, proxyId: op.proxyId, proxy: op.proxy, method: op.method, path: op.path, summary: op.summary ?? null,
    openPolicy: op.openPolicy, resourceNote: op.resourceNote ?? null, state: op.state, updatedAt: op.updatedAt,
  };
}
