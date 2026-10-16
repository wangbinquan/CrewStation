import type { DataEnv, ServiceId } from '@crewstation/contracts';
import { DatabasePhysicalIdentitySchema, ProjectIdSchema, ServiceIdSchema } from '@crewstation/contracts';
import { conflict, notFound, precondition } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import type { DatabaseGeneration, DatabaseEnvironmentBinding } from '../../../domain/databaseGeneration';
import { restoreDatabaseName, sameDatabaseIdentity } from '../../../domain/databaseGeneration';
import type { DatabaseGenerations } from '../../../ports/database/generations';

type Row = { id: string; resource_id: string; project_id: string; service_id: string; env: DataEnv; object_name: string; credential_resource_id: string; secret_box: string | null; origin: DatabaseGeneration['origin']; restore_operation_id: string | null; state: DatabaseGeneration['state']; identity: DatabaseGeneration['identity']; empty_proof: DatabaseGeneration['emptyProof']; created_at: Date | string; updated_at: Date | string };
type BindingRow = { resource_id: string; project_id: string; service_id: string; env: DataEnv; generation_id: string; revision: number; restore_operation_id: string | null; last_restore_operation_id: string | null; previous_generation_id: string | null };
const generation = (row: Row): DatabaseGeneration => ({ id: row.id, resourceId: row.resource_id, projectId: ProjectIdSchema.parse(row.project_id), serviceId: ServiceIdSchema.parse(row.service_id), env: row.env, objectName: row.object_name, credentialResourceId: row.credential_resource_id, secretBox: row.secret_box, origin: row.origin, restoreOperationId: row.restore_operation_id, state: row.state, identity: row.identity ? DatabasePhysicalIdentitySchema.parse(row.identity) : null, emptyProof: row.empty_proof, createdAt: new Date(row.created_at), updatedAt: new Date(row.updated_at) });
const binding = (row: BindingRow): DatabaseEnvironmentBinding => ({ resourceId: row.resource_id, projectId: ProjectIdSchema.parse(row.project_id), serviceId: ServiceIdSchema.parse(row.service_id), env: row.env, generationId: row.generation_id, revision: row.revision, restoreOperationId: row.restore_operation_id, lastRestoreOperationId: row.last_restore_operation_id, previousGenerationId: row.previous_generation_id });
async function current(db: Executor, serviceId: ServiceId, env: DataEnv, lock = false): Promise<BindingRow | undefined> {
  return (await db.execute<BindingRow>(sql`SELECT * FROM data.database_environment_bindings WHERE service_id=${serviceId} AND env=${env} ${lock ? sql`FOR UPDATE` : sql``}`))[0];
}
async function get(db: Executor, id: string): Promise<DatabaseGeneration | undefined> {
  const row = (await db.execute<Row>(sql`SELECT * FROM data.database_generations WHERE id=${id}`))[0]; return row ? generation(row) : undefined;
}

export function databaseGenerationRepository(db: Database): DatabaseGenerations {
  return {
    ensureInitial: (resource) => db.transaction(async (tx) => {
      if (resource.kind !== 'postgres') return;
      await tx.execute(sql`INSERT INTO data.database_generations(id,resource_id,project_id,service_id,env,object_name,credential_resource_id,secret_box,origin,state,created_at,updated_at)
        VALUES(${resource.id},${resource.id},${resource.projectId},${resource.serviceId},${resource.env},${resource.objectName},${resource.id},${resource.secretBox ?? null},'existing','active',${resource.createdAt.toISOString()},${resource.updatedAt.toISOString()}) ON CONFLICT(id) DO NOTHING`);
      await tx.execute(sql`INSERT INTO data.database_environment_bindings(resource_id,project_id,service_id,env,generation_id) VALUES(${resource.id},${resource.projectId},${resource.serviceId},${resource.env},${resource.id}) ON CONFLICT(resource_id) DO NOTHING`);
    }),
    active: async (serviceId, env) => { const row = await current(db, serviceId, env); if (!row) return; const value = await get(db, row.generation_id); if (!value) throw precondition('活动数据库世代记录缺失'); return { binding: binding(row), generation: value }; },
    get: (id) => get(db, id),
    list: async (serviceId) => (await db.execute<Row>(sql`SELECT * FROM data.database_generations WHERE service_id=${serviceId} ORDER BY created_at,id`)).map(generation),
    reserve: (input) => reserve(db, input),
    recordIdentity: (id, identity, emptyProof) => db.transaction(async (tx) => {
      const row = (await tx.execute<Row>(sql`SELECT * FROM data.database_generations WHERE id=${id} FOR UPDATE`))[0];
      if (!row) throw notFound('数据库世代', id);
      if (row.identity && !sameDatabaseIdentity(row.identity, identity)) throw conflict('数据库已被同名替换，不能继续原恢复');
      if (emptyProof && (!sameDatabaseIdentity(identity, emptyProof.identity) || emptyProof.operationId !== row.restore_operation_id || !/^[a-f0-9]{64}$/.test(emptyProof.birthDigest))) throw conflict('空目标证明不属于原恢复');
      if (row.empty_proof && emptyProof && (!sameDatabaseIdentity(row.empty_proof.identity, emptyProof.identity) || row.empty_proof.operationId !== emptyProof.operationId || row.empty_proof.birthDigest !== emptyProof.birthDigest)) throw conflict('不能替换原空目标证明');
      await tx.execute(sql`UPDATE data.database_generations SET identity=coalesce(identity,${JSON.stringify(identity)}::jsonb),empty_proof=coalesce(empty_proof,${emptyProof ? JSON.stringify(emptyProof) : null}::jsonb),state=CASE WHEN state='provisioning' AND ${Boolean(emptyProof)} THEN 'ready' ELSE state END,updated_at=now() WHERE id=${id}`);
    }),
    commit: (input) => commit(db, input),
    finish: (serviceId, operationId) => db.transaction(async (tx) => {
      const row = await current(tx, serviceId, 'production', true);
      if (!row || row.last_restore_operation_id !== operationId) throw conflict('原恢复尚未提交数据库绑定');
      if (row.restore_operation_id && row.restore_operation_id !== operationId) throw conflict('数据库已被另一恢复保留');
      await tx.execute(sql`UPDATE data.database_environment_bindings SET restore_operation_id=NULL,updated_at=now() WHERE resource_id=${row.resource_id}`);
    }),
    withUnreserved: (serviceId, effect) => db.transaction(async (tx) => {
      if ((await current(tx, serviceId, 'production', true))?.restore_operation_id) throw conflict('服务数据库正被恢复操作保留');
      return effect();
    }),
    assertUnreserved: async (serviceId) => { if ((await current(db, serviceId, 'production'))?.restore_operation_id) throw conflict('服务数据库正被恢复操作保留，请在原恢复操作完成后重试', { code: 'database_restore_active' }); },
  };
}
async function reserve(db: Database, input: Parameters<DatabaseGenerations['reserve']>[0]): Promise<DatabaseGeneration> {
  return db.transaction(async (tx) => {
    const row = await current(tx, input.serviceId, 'production', true);
    if (!row) throw precondition('服务尚无生产数据库世代');
    const previous = (await tx.execute<Row>(sql`SELECT * FROM data.database_generations WHERE restore_operation_id=${input.operationId}`))[0];
    if (previous) {
      if (previous.id !== input.id || previous.service_id !== input.serviceId || row.restore_operation_id !== input.operationId && row.last_restore_operation_id !== input.operationId) throw conflict('恢复操作不能改绑数据库目标');
      return generation(previous);
    }
    if (row.generation_id !== input.expectedGenerationId || row.revision !== input.expectedRevision || row.restore_operation_id) throw conflict('生产数据库绑定已变化或存在未结束恢复');
    const access = await tx.execute(sql`SELECT id FROM data.task_bindings WHERE service_id=${input.serviceId} AND mode<>'development' AND state IN ('requested','approved','active') LIMIT 1`);
    if (access.length) throw conflict('请先结束或撤销原生产数据库访问绑定，再创建恢复操作');
    await tx.execute(sql`INSERT INTO data.database_generations(id,resource_id,project_id,service_id,env,object_name,credential_resource_id,origin,restore_operation_id,state)
      VALUES(${input.id},${row.resource_id},${row.project_id},${input.serviceId},'production',${restoreDatabaseName(input.id)},${input.id},'restore',${input.operationId},'provisioning')`);
    await tx.execute(sql`UPDATE data.database_environment_bindings SET restore_operation_id=${input.operationId},updated_at=now() WHERE resource_id=${row.resource_id}`);
    return (await get(tx, input.id))!;
  });
}
async function commit(db: Database, input: Parameters<DatabaseGenerations['commit']>[0]): Promise<DatabaseEnvironmentBinding> {
  return db.transaction(async (tx) => {
    const row = await current(tx, input.serviceId, 'production', true), target = await get(tx, input.targetGenerationId);
    if (!row || !target || target.serviceId !== input.serviceId || target.restoreOperationId !== input.operationId || !target.identity || !target.emptyProof) throw conflict('恢复目标或原操作身份不一致');
    if (row.last_restore_operation_id === input.operationId && row.generation_id === input.targetGenerationId && row.previous_generation_id === input.sourceGenerationId) return binding(row);
    if (row.generation_id !== input.sourceGenerationId || row.revision !== input.expectedRevision || row.restore_operation_id !== input.operationId || target.state !== 'ready') throw conflict('切换前数据库绑定已变化');
    await tx.execute(sql`UPDATE data.database_generations SET state='retained',updated_at=now() WHERE id=${input.sourceGenerationId}`);
    await tx.execute(sql`UPDATE data.database_generations SET state='active',updated_at=now() WHERE id=${input.targetGenerationId}`);
    const next = (await tx.execute<BindingRow>(sql`UPDATE data.database_environment_bindings SET generation_id=${input.targetGenerationId},previous_generation_id=${input.sourceGenerationId},last_restore_operation_id=${input.operationId},revision=revision+1,updated_at=now() WHERE resource_id=${row.resource_id} RETURNING *`))[0]!;
    return binding(next);
  });
}
