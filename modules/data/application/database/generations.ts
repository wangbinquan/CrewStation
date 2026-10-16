import { DatabaseGenerationDtoSchema } from '@crewstation/contracts';
import type { DatabaseBindingDto, ServiceId } from '@crewstation/contracts';
import { conflict, notFound, precondition } from '@crewstation/kernel';
import type { DatabaseGenerationApi } from '../../api/databaseGenerations';
import type { DatabaseGenerations, DatabaseGenerationPlane } from '../../ports/database/generations';
import type { DatabaseGeneration } from '../../domain/databaseGeneration';
import { sameDatabaseIdentity } from '../../domain/databaseGeneration';
import { databaseProjection } from '../../domain/dataRecords';
import type { DataLedger } from '../../ports/ledger';
import type { DataUseCaseDeps } from '../dependencies';
import { dataControlDsn } from '../dataControl';

export interface GenerationDeps { data: DataUseCaseDeps; store: DatabaseGenerations; ledger?: DataLedger; plane?: DatabaseGenerationPlane }
const dto = (row: DatabaseGeneration) => DatabaseGenerationDtoSchema.parse({ id: row.id, resourceId: row.resourceId, projectId: row.projectId, serviceId: row.serviceId, env: row.env, state: row.state, origin: row.origin, restoreOperationId: row.restoreOperationId, identity: row.identity, createdAt: row.createdAt.toISOString() });
const binding = (value: { generationId: string; revision: number; restoreOperationId: string | null }): DatabaseBindingDto => ({ generationId: value.generationId, revision: value.revision, restoreOperationId: value.restoreOperationId });

export function databaseGenerationUseCases(deps: GenerationDeps): DatabaseGenerationApi {
  const { data, store } = deps;
  const owned = async (serviceId: ServiceId, id: string) => { const value = await store.get(id); if (!value || value.serviceId !== serviceId) throw notFound('服务数据库世代', id); await data.authorizer.assertProjectAvailable?.(value.projectId); return value; };
  return {
    list: async (actor, serviceId) => { const service = await data.services.resolveServiceById(serviceId); if (!service) throw notFound('服务', serviceId); await data.authorizer.authorize(actor, service.projectId, 'view'); const active = await store.active(serviceId, 'production'); if (!active) throw precondition('服务尚无生产数据库'); return { active: binding(active.binding), items: (await store.list(serviceId)).map(dto) }; },
    active: async (serviceId, env) => { const active = await store.active(serviceId, env); if (!active) throw precondition('服务数据库世代尚未登记'); return binding(active.binding); },
    reserve: async (input) => { const service = await data.services.resolveServiceById(input.serviceId); if (!service) throw notFound('服务', input.serviceId); await data.authorizer.assertProjectAvailable?.(service.projectId);
      const source=await store.get(input.expectedGenerationId);if(!source||source.serviceId!==input.serviceId||!deps.plane)throw precondition('原数据库物理身份尚不可观测');
      const observed=await deps.plane.inspect({projectId:source.projectId,resourceId:source.credentialResourceId,databaseName:source.objectName});if(!observed)throw conflict('原生产数据库已不存在');
      if(observed.provisioning)throw precondition('原生产数据库供给仍在结算，请在原操作重试');
      await store.recordIdentity(source.id,observed.identity);
      if(source.origin==='existing'&&deps.ledger){const resource=await data.resources.getById(source.resourceId),projection=resource?databaseProjection(resource,true):undefined;if(projection){const {provision:_provision,...spec}=projection.declaration.spec;await deps.ledger.declare({...projection.declaration,spec:{...spec,independentDatabase:true}});}}
      return dto(await store.reserve(input)); },
    prepare: async (serviceId, operationId, id) => {
      let value = await owned(serviceId, id);
      if (value.restoreOperationId !== operationId) throw conflict('目标不属于原恢复操作');
      if (!deps.plane || !deps.ledger || !data.provisioning) throw precondition('平台尚未启用独立数据库目标的物理身份观测');
      const current = await deps.plane.inspect({ projectId: value.projectId, resourceId: value.credentialResourceId, databaseName: value.objectName });
      if (value.identity && (!current || !sameDatabaseIdentity(value.identity, current.identity))) throw conflict('原恢复目标已丢失或被同名替换，不能重建继续');
      if (!value.emptyProof && current) {
        if (current.empty && !current.birthDigest && current.provisioning) return {ready:false,identity:null};
        if (!current.empty || !current.birthDigest) throw conflict('目标不是本操作创建且可证明为空的数据库');
        await store.recordIdentity(id, current.identity, { identity: current.identity, operationId, observedAt: data.clock.now().toISOString(), birthDigest: current.birthDigest });
        value = (await store.get(id))!;
      }
      await projectGeneration(deps, value);
      return { ready: Boolean(value.emptyProof && current && await data.provisioning.credentials.credentialOf(value.credentialResourceId)), identity: value.identity };
    },
    envFor: async (serviceId, id, operationId) => {
      const value = await owned(serviceId, id), active = await store.active(serviceId, value.env);
      if (value.id !== active?.generation.id && (!operationId || value.restoreOperationId !== operationId || active?.binding.restoreOperationId !== operationId)) throw conflict('数据库世代不属于当前绑定或原恢复操作');
      if (value.origin === 'restore' && (!value.identity || !value.emptyProof || !deps.plane)) throw precondition('恢复目标物理身份尚未确认');
      if (value.identity && deps.plane) { const observed = await deps.plane.inspect({ projectId: value.projectId, resourceId: value.credentialResourceId, databaseName: value.objectName }); if (!observed || !sameDatabaseIdentity(value.identity, observed.identity)) throw conflict('数据库物理身份变化'); }
      const dsn = await dataControlDsn(data, value.credentialResourceId, value.objectName) ?? (value.secretBox ? await data.cipher.decrypt(value.secretBox) : undefined);
      if (!dsn) throw precondition('原数据库凭据暂不可用');
      return { CS_DATABASE_URL: dsn, ...(value.origin === 'restore' ? { CS_DATABASE_GENERATION_ID: value.id, CS_DATABASE_GENERATION_OPERATION: value.restoreOperationId! } : {}) };
    },
    commit: async (input) => {
      for(const id of [input.sourceGenerationId,input.targetGenerationId]){const value=await owned(input.serviceId,id);if(!value.identity||!deps.plane)throw precondition('数据库物理身份缺失');const actual=await deps.plane.inspect({projectId:value.projectId,resourceId:value.credentialResourceId,databaseName:value.objectName});if(!actual||!sameDatabaseIdentity(value.identity,actual.identity))throw conflict('切换前数据库物理身份变化');}
      return binding(await store.commit(input)); },
    finish: store.finish,
    assertUnreserved: store.assertUnreserved,
  };
}
/** The logical source resource and its retained generation are separate ledger records after the first restore. */
export async function projectGeneration(deps: GenerationDeps, value: DatabaseGeneration): Promise<void> {
  if (value.origin !== 'restore' || !deps.ledger) return;
  const source = await deps.data.resources.getById(value.resourceId); if (!source) throw precondition('数据库世代缺少原逻辑资源');
  const projection = databaseProjection({ ...source, id: value.id, objectName: value.objectName, secretBox: undefined, state: value.identity ? 'ready' : 'provisioning' }, true)!;
  const { provision: _provision, ...spec } = projection.declaration.spec;
  await deps.ledger.declare({ ...projection.declaration, spec: { ...spec, independentDatabase: true, ...(!value.identity ? { provision: 'data-control' as const } : {}) }, display: { ...projection.declaration.display, generationId: value.id, restoreOperationId: value.restoreOperationId!, retained: 'true' } });
}
