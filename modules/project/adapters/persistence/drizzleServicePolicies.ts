import { ProjectServicePolicySchema } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import { and, eq } from 'drizzle-orm';
import type { ServicePolicyRecord, ServicePolicyRepository } from '../../ports/servicePolicies';
import { servicePlanPolicies } from './servicePolicyTable';

export function drizzleServicePolicies(db: Executor): ServicePolicyRepository {
  return {
    get: async (projectId) => {
      const row = (await db.select().from(servicePlanPolicies).where(eq(servicePlanPolicies.projectId, projectId)))[0];
      return row ? { ...row, projectId, updatedBy: row.updatedBy as ServicePolicyRecord['updatedBy'], policy: ProjectServicePolicySchema.parse(typeof row.policy === 'string' ? JSON.parse(row.policy) : row.policy) } : undefined;
    },
    save: async (record, expectedRevision) => {
      const result = expectedRevision === 0
        ? await db.insert(servicePlanPolicies).values(record).onConflictDoNothing().returning({ revision: servicePlanPolicies.revision })
        : await db.update(servicePlanPolicies).set(record).where(and(eq(servicePlanPolicies.projectId, record.projectId), eq(servicePlanPolicies.revision, expectedRevision))).returning({ revision: servicePlanPolicies.revision });
      return result.length === 1;
    },
  };
}
