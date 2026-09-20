import type { ProjectComputePolicy } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import { and, eq } from 'drizzle-orm';
import type { ProjectPolicyRepository } from '../../ports/repositories';
import type { ProjectComputePolicyRecord } from '../../domain/projectComputePolicy';
import { projectComputePolicies } from './tables';

const decode = (row: typeof projectComputePolicies.$inferSelect): ProjectComputePolicyRecord => ({
  ...row, projectId: row.projectId as ProjectComputePolicyRecord['projectId'], updatedBy: row.updatedBy as ProjectComputePolicyRecord['updatedBy'],
  policy: (typeof row.policy === 'string' ? JSON.parse(row.policy) : row.policy) as ProjectComputePolicy,
});

export function drizzleProjectPolicies(db: Executor): ProjectPolicyRepository {
  return {
    get: async (projectId) => { const row = (await db.select().from(projectComputePolicies).where(eq(projectComputePolicies.projectId, projectId)))[0]; return row ? decode(row) : undefined; },
    save: async (record, expectedRevision) => {
      const result = expectedRevision === 0
        ? await db.insert(projectComputePolicies).values(record).onConflictDoNothing().returning({ revision: projectComputePolicies.revision })
        : await db.update(projectComputePolicies).set(record).where(and(eq(projectComputePolicies.projectId, record.projectId), eq(projectComputePolicies.revision, expectedRevision))).returning({ revision: projectComputePolicies.revision });
      return result.length === 1;
    },
    referencing: async (name) => (await db.select().from(projectComputePolicies)).map(decode).filter((row) => row.policy.allowedProfiles.includes(name)).map((row) => row.projectId),
  };
}
