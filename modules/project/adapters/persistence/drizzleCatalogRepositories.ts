import type { ProjectId, RuntimeConfigId } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import { eq, sql } from 'drizzle-orm';
import type { CatalogRepository, ComputeProfile, QuotaRepository } from '../../ports/repositories';
import { computeProfiles, servicePlans, taskProfiles, taskQuotas } from './tables';

export function drizzleQuotaRepository(db: Executor): QuotaRepository {
  return {
    get: async (projectId) => {
      const row = (await db.select().from(taskQuotas).where(eq(taskQuotas.projectId, projectId)))[0];
      return row ? { projectId: row.projectId as ProjectId, maxConcurrentTasks: row.maxConcurrentTasks } : undefined;
    },
    upsert: async (quota) => {
      await db.insert(taskQuotas).values({ projectId: quota.projectId, maxConcurrentTasks: quota.maxConcurrentTasks })
        .onConflictDoUpdate({ target: taskQuotas.projectId, set: { maxConcurrentTasks: quota.maxConcurrentTasks } });
    },
  };
}

export function drizzleCatalogRepository(db: Executor): CatalogRepository {
  return {
    listServicePlans: () => db.select().from(servicePlans).orderBy(servicePlans.name),
    getServicePlan: async (name) => (await db.select().from(servicePlans).where(eq(servicePlans.name, name)))[0],
    upsertServicePlan: async (plan) => {
      await db.insert(servicePlans).values(plan).onConflictDoUpdate({ target: servicePlans.name, set: { cpu: plan.cpu, memory: plan.memory, maxReplicas: plan.maxReplicas, description: plan.description } });
    },
    listTaskProfiles: () => db.select().from(taskProfiles).orderBy(taskProfiles.name),
    getTaskProfile: async (name) => (await db.select().from(taskProfiles).where(eq(taskProfiles.name, name)))[0],
    upsertTaskProfile: async (profile) => {
      await db.insert(taskProfiles).values(profile).onConflictDoUpdate({ target: taskProfiles.name, set: { cpu: profile.cpu, memory: profile.memory, storage: profile.storage, description: profile.description } });
    },
    listComputeProfiles: async () => (await db.select().from(computeProfiles).orderBy(computeProfiles.name)).map(toComputeProfile),
    getComputeProfile: async (name) => {
      const row = (await db.select().from(computeProfiles).where(eq(computeProfiles.name, name)))[0];
      return row ? toComputeProfile(row) : undefined;
    },
    upsertComputeProfile: async (profile, expectedRevision) => {
      const value = { name: profile.name, driver: profile.driver, model: profile.model, description: profile.description, taskProfile: profile.taskProfile ?? null, runtimeConfigId: profile.runtimeConfigId ?? null, revision: 1 };
      // 版本比较在同一条 UPDATE 里完成：条件不成立就一行都不改，调用方据此报冲突而不是覆盖别人的绑定。
      const rows = await db.insert(computeProfiles).values(value).onConflictDoUpdate({
        target: computeProfiles.name,
        set: { driver: value.driver, model: value.model, description: value.description, taskProfile: value.taskProfile, runtimeConfigId: value.runtimeConfigId, revision: sql`${computeProfiles.revision} + 1` },
        ...(expectedRevision === undefined ? {} : { setWhere: sql`${computeProfiles.revision} = ${expectedRevision}` }),
      }).returning();
      return rows[0] ? toComputeProfile(rows[0]) : undefined;
    },
    deleteComputeProfile: async (name) => { await db.delete(computeProfiles).where(eq(computeProfiles.name, name)); },
    listComputeProfilesByRuntimeConfig: async (runtimeConfigId) => (await db.select().from(computeProfiles).where(eq(computeProfiles.runtimeConfigId, runtimeConfigId)).orderBy(computeProfiles.name)).map(toComputeProfile),
  };
}

function toComputeProfile(row: typeof computeProfiles.$inferSelect): ComputeProfile {
  return {
    name: row.name, driver: row.driver as ComputeProfile['driver'], model: row.model, description: row.description, revision: row.revision,
    ...(row.taskProfile ? { taskProfile: row.taskProfile } : {}), ...(row.runtimeConfigId ? { runtimeConfigId: row.runtimeConfigId as RuntimeConfigId } : {}),
  };
}
