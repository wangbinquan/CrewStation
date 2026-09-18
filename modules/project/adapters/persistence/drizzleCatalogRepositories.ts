import type { ProjectId } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import { eq } from 'drizzle-orm';
import type { CatalogRepository, QuotaRepository } from '../../ports/repositories';
import { servicePlans, taskProfiles, taskQuotas } from './tables';

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
  };
}

