import type { Executor } from '@crewstation/persistence';
import { ProjectNamespaceQuotaDtoSchema } from '@crewstation/contracts';
import { conflict } from '@crewstation/kernel';
import { and, eq, sql } from 'drizzle-orm';
import type { ProjectResourcePolicies } from '../../ports/resourcePolicies';
import { namespaceQuotas, resourcePolicyReceipts } from './resourcePolicyTable';

export function drizzleResourcePolicies(db: Executor): ProjectResourcePolicies {
  return {
    namespace: async (projectId) => { const row = (await db.select().from(namespaceQuotas).where(eq(namespaceQuotas.projectId, projectId)))[0]; return row ? ProjectNamespaceQuotaDtoSchema.parse({ projectId, revision: row.revision, quota: row.quota, updatedAt: row.updatedAt.toISOString() }) : undefined; },
    saveNamespace: async (record, expectedRevision, actorId) => {
      const row = { ...record, updatedAt: new Date(record.updatedAt!), actorId };
      const result = expectedRevision === 0 ? await db.insert(namespaceQuotas).values(row).onConflictDoNothing().returning({ id: namespaceQuotas.projectId }) : await db.update(namespaceQuotas).set(row).where(and(eq(namespaceQuotas.projectId, record.projectId), eq(namespaceQuotas.revision, expectedRevision))).returning({ id: namespaceQuotas.projectId });
      return result.length === 1;
    },
    receipt: async (operationId, projectId) => (await db.select().from(resourcePolicyReceipts).where(and(eq(resourcePolicyReceipts.operationId, operationId), eq(resourcePolicyReceipts.projectId, projectId))))[0]?.body,
    saveReceipt: async (operationId, projectId, body) => { await db.insert(resourcePolicyReceipts).values({ operationId, projectId, body }); },
    lock: async (projectId) => { const rows = await db.execute<{ acquired: boolean }>(sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${`project-resources:${projectId}`}, 0)) AS acquired`); if (!rows[0]?.acquired) throw conflict('项目资源配置正在更新，请重试'); },
  };
}
