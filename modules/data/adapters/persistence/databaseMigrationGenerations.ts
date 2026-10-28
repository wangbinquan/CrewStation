import { conflict, precondition } from '@crewstation/kernel';
import type { Database } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import type { DatabaseGenerations } from '../../ports/repositories';
import { binding, current, get } from './generationRows';
import type { BindingRow } from './generationRows';
type MigrationMethods = Pick<DatabaseGenerations,'reserveMigration'|'commitMigration'|'revertMigration'|'openMigration'|'finishMigration'>;
export function migrationGenerationRepository(db: Database): MigrationMethods {
  return {
    reserveMigration: input => reserveMigration(db,input),
    commitMigration: input => changeBinding(db,input,false),
    revertMigration: input => changeBinding(db,input,true),
    openMigration: (serviceId,operationId) => db.transaction(async tx => {
      const row=await current(tx,serviceId,'production',true);
      if(!row||row.migration_operation_id!==operationId||row.last_migration_operation_id!==operationId||row.migration_reverted)throw conflict('迁移尚未激活');
      await tx.execute(sql`UPDATE data.database_environment_bindings SET migration_opened=true WHERE resource_id=${row.resource_id}`);
    }),
    finishMigration: (serviceId,operationId) => db.transaction(async tx => {
      const row=await current(tx,serviceId,'production',true);
      if(!row)throw precondition('生产数据库不存在');
      if(!row.migration_operation_id&&row.last_migration_operation_id===operationId)return;
      if(row.migration_operation_id!==operationId)throw conflict('迁移预留已变化');
      await tx.execute(sql`UPDATE data.database_generations SET state='retained',updated_at=now() WHERE migration_operation_id=${operationId} AND state<>'active'`);
      await tx.execute(sql`UPDATE data.database_environment_bindings SET migration_operation_id=NULL,last_migration_operation_id=${operationId},updated_at=now() WHERE resource_id=${row.resource_id}`);
    }),
  };
}
async function reserveMigration(db:Database,input:Parameters<MigrationMethods['reserveMigration']>[0]){
  return db.transaction(async tx=>{
    const row=await current(tx,input.serviceId,'production',true);if(!row)throw precondition('服务尚无生产数据库');
    const prior=await get(tx,input.id),scratch=await get(tx,input.scratchId);
    if(prior||scratch){
      if(prior?.migrationOperationId!==input.operationId||scratch?.migrationOperationId!==input.operationId||prior.serviceId!==input.serviceId||scratch.serviceId!==input.serviceId||prior.origin!=='migration'||scratch.origin!=='migration-scratch'||row.migration_operation_id!==input.operationId)throw conflict('迁移不能改绑目标或 scratch');
      return prior;
    }
    if(row.migration_operation_id)throw conflict('服务数据库正在迁移',{code:'database_migration_active'});
    if(row.restore_operation_id)throw conflict('服务数据库正在恢复',{code:'database_restore_active'});
    if(row.generation_id!==input.expectedGenerationId||row.revision!==input.expectedRevision||input.id===input.scratchId)throw conflict('生产数据库绑定已变化');
    if((await tx.execute(sql`SELECT id FROM data.task_bindings WHERE service_id=${input.serviceId} AND mode<>'development' AND state IN ('requested','approved','active') LIMIT 1`)).length)throw conflict('请先结束生产数据库访问绑定');
    for(const [id,origin,prefix] of [[input.id,'migration','cs_migrate_'],[input.scratchId,'migration-scratch','cs_mscratch_']] as const){
      await tx.execute(sql`INSERT INTO data.database_generations(id,resource_id,project_id,service_id,env,object_name,credential_resource_id,origin,migration_operation_id,state) VALUES(${id},${row.resource_id},${row.project_id},${input.serviceId},'production',${prefix+id.replaceAll('-','')},${id},${origin},${input.operationId},'provisioning')`);
    }
    await tx.execute(sql`UPDATE data.database_environment_bindings SET migration_operation_id=${input.operationId},migration_opened=false,migration_reverted=false,updated_at=now() WHERE resource_id=${row.resource_id}`);
    return (await get(tx,input.id))!;
  });
}
async function changeBinding(db:Database,input:Parameters<MigrationMethods['commitMigration']>[0],revert:boolean){
  return db.transaction(async tx=>{
    const row=await current(tx,input.serviceId,'production',true),target=await get(tx,input.targetGenerationId);
    if(!row||!target||target.origin!=='migration'||target.migrationOperationId!==input.operationId||target.serviceId!==input.serviceId||!target.identity||!target.emptyProof)throw conflict('迁移目标身份不一致');
    if(revert&&row.migration_opened)throw conflict('迁移已经开放',{code:'database_migration_opened'});
    if(row.last_migration_operation_id===input.operationId&&row.migration_reverted===revert&&row.generation_id===(revert?input.sourceGenerationId:input.targetGenerationId)&&row.previous_generation_id===input.sourceGenerationId)return binding(row);
    if(row.migration_operation_id!==input.operationId)throw conflict('迁移预留已变化');
    if(revert&&row.generation_id===input.sourceGenerationId&&row.revision===input.expectedRevision)return binding(row);
    if(row.migration_reverted||row.generation_id!==(revert?input.targetGenerationId:input.sourceGenerationId)||row.revision!==input.expectedRevision+(revert?1:0))throw conflict('迁移绑定 CAS 失败',{code:'stale_revision'});
    const active=revert?input.sourceGenerationId:input.targetGenerationId,retained=revert?input.targetGenerationId:input.sourceGenerationId;
    await tx.execute(sql`UPDATE data.database_generations SET state='retained',updated_at=now() WHERE id=${retained}`);
    await tx.execute(sql`UPDATE data.database_generations SET state='active',updated_at=now() WHERE id=${active}`);
    const next=(await tx.execute<BindingRow>(sql`UPDATE data.database_environment_bindings SET generation_id=${active},previous_generation_id=${input.sourceGenerationId},last_migration_operation_id=${input.operationId},migration_reverted=${revert},revision=revision+1,updated_at=now() WHERE resource_id=${row.resource_id} RETURNING *`))[0]!;
    return binding(next);
  });
}
