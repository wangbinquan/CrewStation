import type { ProjectComputePolicy } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import { and, eq, sql } from 'drizzle-orm';
import { conflict } from '@crewstation/kernel';
import { allocationReceipts } from './allocationTable';
import type { ProjectPolicyRepository } from '../../ports/repositories';
import type { ProjectComputePolicyRecord } from '../../domain/projectComputePolicy';
import { projectComputePolicies } from './tables';

const decode = (row: typeof projectComputePolicies.$inferSelect): ProjectComputePolicyRecord => ({
  ...row, projectId: row.projectId as ProjectComputePolicyRecord['projectId'], updatedBy: row.updatedBy as ProjectComputePolicyRecord['updatedBy'],
  policy: (typeof row.policy === 'string' ? JSON.parse(row.policy) : row.policy) as ProjectComputePolicy,
});

export function drizzleProjectPolicies(db: Executor): ProjectPolicyRepository {
  return {
    receipt: async (projectId, operationId) => (await db.select().from(allocationReceipts).where(and(eq(allocationReceipts.projectId, projectId), eq(allocationReceipts.operationId, operationId))))[0]?.body,
    saveReceipt: async (projectId, operationId, body) => { await db.insert(allocationReceipts).values({ projectId, operationId, body }); },
    lock: async (projectId) => { const rows = await db.execute<{ acquired: boolean }>(sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${`agent-resource:${projectId}`}, 0)) AS acquired`); if (!rows[0]?.acquired) throw conflict('算力分配正在更新，请重试'); },
    get: async (projectId) => { const row = (await db.select().from(projectComputePolicies).where(eq(projectComputePolicies.projectId, projectId)))[0]; return row ? decode(row) : undefined; },
    save: async (record, expectedRevision) => {
      const result = expectedRevision === 0
        ? await db.insert(projectComputePolicies).values(record).onConflictDoNothing().returning({ revision: projectComputePolicies.revision })
        : await db.update(projectComputePolicies).set(record).where(and(eq(projectComputePolicies.projectId, record.projectId), eq(projectComputePolicies.revision, expectedRevision))).returning({ revision: projectComputePolicies.revision });
      return result.length === 1;
    },
    referencing: async (name) => (await db.select().from(projectComputePolicies)).map(decode).filter((row) => row.policy.allowedProfiles.includes(name) || row.policy.additionalProfiles?.includes(name)).map((row) => row.projectId),
  };
}
