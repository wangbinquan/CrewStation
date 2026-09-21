import type { ProjectId } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import { conflict } from '@crewstation/kernel';
import { and, eq } from 'drizzle-orm';
import type { CatalogRepository, QuotaRepository } from '../../ports/repositories';
import { servicePlans, taskProfiles, taskQuotas } from './tables';

export function drizzleQuotaRepository(db: Executor): QuotaRepository {
  return {
    compareAndSet: async (quota, expected) => (await db.update(taskQuotas).set({ maxConcurrentTasks: quota.maxConcurrentTasks })
      .where(and(eq(taskQuotas.projectId, quota.projectId), eq(taskQuotas.maxConcurrentTasks, expected))).returning({ projectId: taskQuotas.projectId })).length === 1,
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
    getServicePlan: async (id) => (await db.select().from(servicePlans).where(eq(servicePlans.id, id)))[0],
    createServicePlan: async (plan) => { if (!(await db.insert(servicePlans).values(plan).onConflictDoNothing({ target: servicePlans.id }).returning()).length) throw conflict("服务套餐 ID 已存在"); },
    updateServicePlan: async (plan) => (await db.update(servicePlans).set(plan).where(eq(servicePlans.id, plan.id)).returning({ id: servicePlans.id })).length === 1,
    listTaskProfiles: () => db.select().from(taskProfiles).orderBy(taskProfiles.name),
    getTaskProfile: async (id) => (await db.select().from(taskProfiles).where(eq(taskProfiles.id, id)))[0],
    createTaskProfile: async (profile) => { if (!(await db.insert(taskProfiles).values(profile).onConflictDoNothing({ target: taskProfiles.id }).returning()).length) throw conflict("任务规格 ID 已存在"); },
    updateTaskProfile: async (profile) => (await db.update(taskProfiles).set(profile).where(eq(taskProfiles.id, profile.id)).returning({ id: taskProfiles.id })).length === 1,
  };
}
