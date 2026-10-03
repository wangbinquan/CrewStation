import { ProjectIdSchema, ResourceIdSchema, ServiceIdSchema, TaskIdSchema, TaskKindSchema } from '@crewstation/contracts';
import type { ProjectId } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Database } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { DevelopmentParentEpochSchema, developmentParentEpochHash } from '../../../domain/development/parentEnding';
import { PROFILE_TEST_PROJECT_ID, PROFILE_TEST_SERVICE_ID } from '../../../domain/profileTestEnvironment';

type Kind = 'task' | 'rebuild' | 'parent-ending';
/** Full keyset traversal includes project-bound platform validation tasks as well as ordinary historical environments. */
export async function originalProjectTaskIds(db: Database, projectId: ProjectId, after: string | null) {
  const rows = await db.execute<{ id: string }>(sql`SELECT id FROM task_runtime.environments
    WHERE (project_id=${projectId} AND kind<>'profile-test' OR kind='profile-test' AND render->'runtimeValidation'->>'projectId'=${projectId})
    ${after === null ? sql`` : sql`AND id>${after}`} ORDER BY id COLLATE "C" LIMIT 200`);
  return rows.map((row) => TaskIdSchema.parse(row.id));
}
/** Minimum ownership fields only; runner tokens, DSNs, rebuild input and accepted render stay private. */
export async function runtimeInfrastructureOrigin(db: Database, kind: Kind, key: string, representation: 'current' | 'legacy' = 'current') {
  if (!['task', 'rebuild', 'parent-ending'].includes(kind) || !['current', 'legacy'].includes(representation)) throw precondition('运行环境原来源类型未登记');
  if (representation === 'current') ResourceIdSchema.parse(key);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`);
    const alias = (await tx.execute<{ id: string }>(sql`SELECT id FROM task_runtime.resource_identity_aliases WHERE kind=${kind} AND key=${JSON.stringify([key])}`))[0]?.id;
    const canonical = ResourceIdSchema.safeParse(key).success ? key : undefined;
    if (alias && canonical && alias !== canonical) throw precondition('运行环境原标识目录冲突');
    if (!alias && !canonical) return undefined;
    const id = ResourceIdSchema.parse(alias ?? canonical);
    let projectId: string, parentId: string | undefined;
    if (kind === 'task') {
      const row = (await tx.execute<{ project_id: string; service_id: string; kind: string; validation_project: string | null; validation_present: boolean }>(sql`SELECT project_id,service_id,kind,
        coalesce(render ? 'runtimeValidation',false) AS validation_present,render->'runtimeValidation'->>'projectId' AS validation_project FROM task_runtime.environments WHERE id=${id}`))[0];
      if (!row) return undefined;
      TaskKindSchema.parse(row.kind); ServiceIdSchema.parse(row.service_id);
      if (row.kind === 'profile-test') {
        if (row.project_id !== PROFILE_TEST_PROJECT_ID || row.service_id !== PROFILE_TEST_SERVICE_ID) throw precondition('平台测试原范围冲突');
        if (!row.validation_present) return { complete: true as const, id, scope: 'platform' as const, projectIds: [] as const,
          revision: jsonHash({ kind, id, platformTest: true }) };
        projectId = ProjectIdSchema.parse(row.validation_project);
      } else projectId = row.project_id;
    } else if (kind === 'rebuild') {
      const row = (await tx.execute<{ project_id: string; task_id: string }>(sql`SELECT project_id,task_id FROM task_runtime.environment_rebuilds WHERE id=${id}`))[0];
      if (!row) return undefined;
      projectId = row.project_id; parentId = TaskIdSchema.parse(row.task_id);
    } else {
      const row = (await tx.execute<{ project_id: string; parent_id: string; epoch: unknown; epoch_hash: string }>(sql`SELECT project_id,parent_id,epoch,epoch_hash
        FROM task_runtime.development_parent_endings WHERE id=${id}`))[0];
      if (!row) return undefined;
      const epoch = DevelopmentParentEpochSchema.parse(row.epoch);
      if (epoch.parentId !== row.parent_id || epoch.projectId !== row.project_id || developmentParentEpochHash(epoch) !== row.epoch_hash) throw precondition('原父结束身份与受理范围冲突');
      projectId = row.project_id; parentId = epoch.parentId;
    }
    const project = ProjectIdSchema.parse(projectId);
    if (parentId) {
      const parent = (await tx.execute<{ project_id: string }>(sql`SELECT project_id FROM task_runtime.environments WHERE id=${parentId}`))[0];
      if (parent && parent.project_id !== project) throw precondition('运行环境原项目归属冲突');
    }
    return { complete: true as const, id, scope: 'project' as const, projectIds: [project], revision: jsonHash({ kind, id, projectId: project, ...(parentId ? { parentId } : {}) }) };
  });
}
