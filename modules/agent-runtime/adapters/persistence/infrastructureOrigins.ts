import { ProfileTestContextSchema, ResourceIdSchema } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Database } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';

/** Profile tests explicitly run in the platform namespace. Missing or retired context is not proof of ownership. */
export async function profileTestInfrastructureOrigin(db: Database, key: string, representation: 'current' | 'legacy' = 'current') {
  if (representation !== 'current' && representation !== 'legacy') throw precondition('档位测试原表示类型未登记');
  if (representation === 'current') ResourceIdSchema.parse(key);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`);
    const alias = (await tx.execute<{ id: string }>(sql`SELECT id FROM agent_runtime.resource_identity_aliases
      WHERE kind='profile-test' AND key=${JSON.stringify([key])}`))[0]?.id;
    const canonical = ResourceIdSchema.safeParse(key).success ? key : undefined;
    if (alias && canonical && alias !== canonical) throw precondition('档位测试原标识目录冲突');
    if (!alias && !canonical) return undefined;
    const id = ResourceIdSchema.parse(alias ?? canonical);
    const row = (await tx.execute<{ profile: string; revision: number; context: unknown }>(sql`SELECT profile,revision,context
      FROM agent_runtime.profile_tests WHERE test_id=${id}`))[0];
    if (!row) return undefined;
    const context = ProfileTestContextSchema.safeParse(row.context);
    if (!context.success) return undefined;
    if (Object.hasOwn(row.context as object, 'projectId')) throw precondition('档位测试平台范围与项目归属冲突');
    const profileId = ResourceIdSchema.parse(row.profile);
    if (!Number.isSafeInteger(row.revision) || row.revision < 1) throw precondition('档位测试原修订不可读取');
    return { complete: true as const, id, scope: 'platform' as const, projectIds: [] as const,
      revision: jsonHash({ kind: 'profile-test', id, profileId, revision: row.revision, namespace: context.data.kind }) };
  });
}

/** Current retained identity evidence for explicit operator review. It deliberately supplies no original project/platform ownership. */
export async function currentProfileTestEvidence(db: Database, key: string) {
  const id = ResourceIdSchema.parse(key);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`);
    const retired = await tx.execute(sql`SELECT id FROM agent_runtime.retired_test_identities WHERE id=${id}`);
    const current = await tx.execute(sql`SELECT to_jsonb(t) AS body FROM agent_runtime.profile_tests t WHERE test_id=${id}`);
    const aliases = await tx.execute<{ key: string }>(sql`SELECT key FROM agent_runtime.resource_identity_aliases WHERE kind='profile-test' AND id=${id} ORDER BY key`);
    const keys = aliases.flatMap(({ key }) => { const value: unknown = JSON.parse(key); if (!Array.isArray(value) || value.length !== 1 || typeof value[0] !== 'string') throw precondition('档位测试保留标识不完整'); return value as string[]; });
    return { complete: true as const, id, retired: retired.length === 1 && current.length === 0, active: current.length !== 0, aliases: keys, digest: jsonHash({ id, retired, current, aliases }) };
  });
}
