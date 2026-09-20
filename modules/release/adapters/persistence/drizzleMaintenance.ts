import type { Executor } from '@crewstation/persistence';
import type { Manifest } from '@crewstation/contracts';
import { and, eq, gt, inArray } from 'drizzle-orm';
import { precondition } from '@crewstation/kernel';
import type { MaintenanceRepository } from '../../ports/repositories';
import type { ClusterSlotProjection } from '../../domain/slotMaintenance';
import type { SlotState } from '../../domain/slots';
import { replicaOverrides, slotMaintenance, serviceSlots, releases } from './tables';
export function drizzleMaintenance(db: Executor): MaintenanceRepository {
  const where = (serviceId: string, physical: string) => and(eq(replicaOverrides.serviceId, serviceId), eq(replicaOverrides.physical, physical));
  return {
    get: async (id) => (await db.select().from(slotMaintenance).where(eq(slotMaintenance.id, id)))[0]?.body,
    active: async (serviceId) => (await db.select().from(slotMaintenance).where(and(eq(slotMaintenance.serviceId, serviceId), inArray(slotMaintenance.state, ['prepared', 'applied']))))[0]?.body,
    save: async (r) => { const value = { id: r.operation.operationId, serviceId: r.operation.target.serviceId!, state: r.state, body: r }; await db.insert(slotMaintenance).values(value).onConflictDoUpdate({ target: slotMaintenance.id, set: value }); },
    override: async (serviceId, physical) => (await db.select().from(replicaOverrides).where(where(serviceId, physical)))[0]?.replicas,
    setOverride: async (serviceId, physical, replicas) => { if (replicas === undefined) await db.delete(replicaOverrides).where(where(serviceId, physical)); else await db.insert(replicaOverrides).values({ serviceId, physical, replicas }).onConflictDoUpdate({ target: [replicaOverrides.serviceId, replicaOverrides.physical], set: { replicas } }); },
    projection: async (serviceId) => {
      const result: ClusterSlotProjection[] = []; let after: string | undefined;
      for (let page = 0; page < 1000; page++) {
      const slots = await db.select().from(serviceSlots).where(and(serviceId ? eq(serviceSlots.serviceId, serviceId) : undefined, after ? gt(serviceSlots.serviceId, after) : undefined)).orderBy(serviceSlots.serviceId).limit(500);
      const serviceIds = slots.map((s) => s.serviceId);
      const overrides = serviceIds.length ? await db.select().from(replicaOverrides).where(inArray(replicaOverrides.serviceId, serviceIds)) : [];
      const json = <T>(v: unknown): T => (typeof v === 'string' ? JSON.parse(v) : v) as T;
      const ids = slots.flatMap((s) => [json<SlotState>(s.blue).releaseId, json<SlotState>(s.green).releaseId]).filter((id): id is NonNullable<typeof id> => !!id);
      const versions = ids.length ? await db.select().from(releases).where(inArray(releases.id, ids)) : [];
      result.push(...slots.flatMap((s) => (['blue', 'green'] as const).map((physical): ClusterSlotProjection => {
        const slot = json<SlotState>(s[physical]), release = versions.find((r) => r.id === slot.releaseId), manifest = release?.manifest ? json<Manifest>(release.manifest) : undefined;
        const override = overrides.find((o) => o.serviceId === s.serviceId && o.physical === physical)?.replicas;
        return { serviceId: s.serviceId, physical, role: s.active === physical ? 'prod' : 'preview', state: slot.state, revision: JSON.stringify([s.active, slot.releaseId, slot.state, override, release?.configVersion]), ...(slot.releaseId ? { releaseId: slot.releaseId } : {}), ...(manifest ? { manifestReplicas: manifest.spec.service.replicas, plan: manifest.spec.service.servicePlanId } : {}), ...(override === undefined ? {} : { overrideReplicas: override }) };
      })));
      if (slots.length < 500) return result;
      after = slots.at(-1)!.serviceId;
      }
      throw precondition('发布槽目录超过单轮采集上限，保留上次快照');
    },
  };
}
