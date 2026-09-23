import type { AllowlistDocument, RouteEntry, WorkloadKind } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import type { PodIdentityRecord } from '../../domain/podIdentity';
import type { AllowlistRepository, PodIdentityRepository, RouteRepository } from '../../ports/repositories';
import { allowlists, podIdentities, routes } from './tables';

const json = <T>(v: unknown): T => (typeof v === 'string' ? JSON.parse(v) : v) as T;

export function drizzleAllowlistRepository(db: Executor): AllowlistRepository {
  return {
    latest: async () => {
      const row = (await db.select().from(allowlists).orderBy(desc(allowlists.version)).limit(1))[0];
      return row ? json<AllowlistDocument>(row.document) : undefined;
    },
    save: async (doc) => { await db.insert(allowlists).values({ version: doc.version, document: doc, generatedAt: new Date(doc.generatedAt) }); },
  };
}

export function drizzlePodIdentityRepository(db: Executor): PodIdentityRepository {
  const toRecord = (row: typeof podIdentities.$inferSelect): PodIdentityRecord => ({
    ip: row.ip, podName: row.podName, namespace: row.namespace, project: row.project, service: row.service, workload: row.workload as WorkloadKind,
    ...(row.physicalSlot ? { physicalSlot: row.physicalSlot } : {}), ...(row.taskId ? { taskId: row.taskId } : {}),
    version: row.version, updatedAt: row.updatedAt, ...(row.deletedAt ? { deletedAt: row.deletedAt } : {}),
  });
  return {
    upsert: async (r) => {
      const values = { namespace: r.namespace, podName: r.podName, ip: r.ip, project: r.project, service: r.service, workload: r.workload, physicalSlot: r.physicalSlot ?? null, taskId: r.taskId ?? null, version: 1, updatedAt: r.updatedAt, deletedAt: null };
      const rows = await db.insert(podIdentities).values(values)
        .onConflictDoUpdate({ target: [podIdentities.namespace, podIdentities.podName], set: { ...values, version: sql`${podIdentities.version} + 1` } })
        .returning();
      return toRecord(rows[0]!);
    },
    pruneStale: async (before, at) => (await db.update(podIdentities).set({ deletedAt: at, updatedAt: at })
      .where(and(isNull(podIdentities.deletedAt), lt(podIdentities.updatedAt, before))).returning({ podName: podIdentities.podName })).length,
    markDeleted: async (podName, namespace, at) => {
      await db.update(podIdentities).set({ deletedAt: at, updatedAt: at }).where(and(eq(podIdentities.namespace, namespace), eq(podIdentities.podName, podName)));
    },
    byIp: async (ip) => {
      const rows = await db.select().from(podIdentities).where(and(eq(podIdentities.ip, ip), isNull(podIdentities.deletedAt))).orderBy(desc(podIdentities.updatedAt)).limit(1);
      return rows[0] ? toRecord(rows[0]) : undefined;
    },
    listActive: async () => (await db.select().from(podIdentities).where(isNull(podIdentities.deletedAt))).map(toRecord),
  };
}

export function drizzleRouteRepository(db: Executor): RouteRepository {
  return {
    saveForService: async (serviceId, serviceName, entries) => {
      const values = { serviceId, serviceName, routes: entries, updatedAt: new Date() };
      await db.insert(routes).values(values).onConflictDoUpdate({ target: routes.serviceId, set: values });
    },
    listAll: async () => (await db.select().from(routes).orderBy(routes.serviceName)).map((r) => ({ serviceId: r.serviceId, serviceName: r.serviceName, routes: json<RouteEntry[]>(r.routes) })),
  };
}
