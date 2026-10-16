import type { Actor, DataEnv, DataResourceDto, DatabaseBindingDto, ProjectId, ServiceId } from '@crewstation/contracts';
import { DatabaseGenerationDtoSchema, DataEnvSchema, DataResourceKindSchema, DataResourceStateSchema, TaskDataBindingStateSchema, TaskDataModeSchema } from '@crewstation/contracts';
import { createHash } from 'node:crypto';
import { conflict, newId, notFound, precondition } from '@crewstation/kernel';
import type { DataNativePostgresDsn, DataNativePostgresHistory } from '../api/moduleApi';
import type { DatabaseGenerationApi } from '../api/databaseGenerations';
import type { DatabaseGenerationPlane, DatabaseGenerations, NativePostgresHistoryStore } from '../ports/repositories';
import type { DatabaseGeneration } from '../domain/databaseGeneration';
import { sameDatabaseIdentity } from '../domain/databaseGeneration';
import { databaseProjection } from '../domain/dataRecords';
import type { DataLedger } from '../ports/ledger';
import type { SecretCipher } from '../ports/providers';
import type { DataResource } from '../domain/dataResource';
import { ENV_VAR_BY_KIND, postgresObjectName, transition } from '../domain/dataResource';
import { awaitProvisioned, dataControlDsn } from './dataControl';
import type { DataUseCaseDeps } from './dependencies';

/**
 * 生产库与开发库随服务供给一次，之后跨发布保留；供给失败留下 failed 记录可重试，不自动删除已有数据。
 * 配了 data-control（RFC-025 I28）时库与运行角色由它建、口令它存，这里只写期望、等它建好。
 */
export function serviceDataUseCases(deps: DataUseCaseDeps) {
  const { resources, postgres, cipher, services, clock, logger } = deps;

  const provision = async (serviceId: ServiceId, projectId: ProjectId, slug: string, env: DataEnv): Promise<DataResource> => {
    const existing = await resources.find(serviceId, env, 'postgres');
    if (existing && existing.state === 'ready') return existing;
    const now = clock.now();
    const objectName = postgresObjectName(slug, env);
    let resource: DataResource = existing
      ? transition(existing, 'provisioning', now)
      : { id: newId('dat'), projectId, serviceId, kind: 'postgres', env, plan: deps.settings.defaultPlan, state: 'requested', envVar: ENV_VAR_BY_KIND.postgres, objectName, createdAt: now, updatedAt: now };
    if (existing) await resources.update(resource); else await resources.insert(resource);
    if (!existing) { resource = transition(resource, 'provisioning', now); await resources.update(resource); }
    // 由 data-control 建（RFC-025 I28）：「供给中」这一版的投影已把期望（标明由它建）写进台账，这里只等它建好。
    if (deps.provisioning) {
      resource = await awaitDataControl(deps, resource);
      await resources.update(resource);
      return resource;
    }
    try {
      const { dsn } = await postgres.provisionDatabase({ databaseName: objectName, roleName: objectName, origin: { projectId: resource.projectId as ProjectId, resourceId: resource.id } });
      resource = transition(resource, 'ready', clock.now(), { secretBox: await cipher.encrypt(dsn) });
    } catch (error) {
      resource = transition(resource, 'failed', clock.now(), { message: error instanceof Error ? error.message : String(error) });
      logger.error('data provisioning failed', { serviceId, env, error: resource.message });
    }
    await resources.update(resource);
    return resource;
  };

  return {
    ensureServiceData: async (serviceId: ServiceId): Promise<DataResourceDto[]> => {
      const svc = await services.resolveServiceById(serviceId);
      if (!svc) throw notFound('服务', serviceId);
      await deps.authorizer.assertProjectAvailable?.(svc.projectId);
      const out: DataResource[] = [];
      for (const env of ['production', 'development'] as DataEnv[]) out.push(await provision(serviceId, svc.projectId, svc.slug, env));
      for (const resource of out) await deps.generations?.store.ensureInitial(resource);
      return out.map(toDto);
    },
    envFor: async (serviceId: ServiceId, env: DataEnv): Promise<Record<string, string>> => {
      const values: Record<string, string> = {};
      for (const resource of await resources.listByService(serviceId)) {
        if (resource.env !== env || resource.state !== 'ready') continue;
        await deps.authorizer.assertProjectAvailable?.(resource.projectId as ProjectId);
        if (resource.kind === 'postgres' && deps.generations) {
          await deps.generations.store.ensureInitial(resource);
          const binding = await deps.generations.api.active(serviceId, env);
          Object.assign(values, await deps.generations.api.envFor(serviceId, binding.generationId));
          continue;
        }
        // 旧库的连接串 data 自己存着；data-control 建的（I28）经端口要口令，这里拼成连接串，不落库。
        const dsn = await dataControlDsn(deps, resource.id, resource.objectName) ?? (resource.secretBox ? await cipher.decrypt(resource.secretBox) : undefined);
        if (dsn) values[resource.envVar] = dsn;
      }
      return values;
    },
    listResources: async (actor: Actor, projectId: ProjectId): Promise<DataResourceDto[]> => {
      await deps.authorizer.authorize(actor, projectId, 'view');
      return (await resources.listByProject(projectId)).map(toDto);
    },
    /** 供开发会话与业务任务的临时角色使用：生产库的对象名与运行角色。 */
    productionDatabase: async (serviceId: ServiceId): Promise<{ databaseName: string; roleName: string } | undefined> => {
      const prod = await resources.find(serviceId, 'production', 'postgres');
      const current = deps.generations ? await deps.generations.store.active(serviceId, 'production') : undefined;
      if (current && prod?.state === 'ready') return { databaseName: current.generation.objectName, roleName: current.generation.objectName };
      return prod?.state === 'ready' ? { databaseName: prod.objectName, roleName: prod.objectName } : undefined;
    },
  };
}

/** 等 data-control 建好（I28）；过了时限记失败——期望留着，调和器会接着建，下次开通（重试）时再等。 */
async function awaitDataControl(deps: DataUseCaseDeps, resource: DataResource): Promise<DataResource> {
  const outcome = await awaitProvisioned(deps, resource.id);
  if (outcome.ready) return transition(resource, 'ready', deps.clock.now());
  deps.logger.error('data provisioning timed out', { resourceId: resource.id, phase: outcome.phase });
  return transition(resource, 'failed', deps.clock.now(), { message: '数据库没有在时限内建好，平台会继续建，稍后重试开通即可' });
}

export function toDto(r: DataResource): DataResourceDto {
  return { id: r.id, projectId: r.projectId, kind: r.kind, env: r.env, plan: r.plan, state: r.state, envVar: r.envVar, ...(r.message ? { message: r.message } : {}), createdAt: r.createdAt.toISOString() };
}

const nativeHistoryDigest = (value: string): string => createHash('sha256').update(value).digest('hex');
const nativeHistoryName = (name: string): boolean => name.length > 0 && !name.includes('\0') && Buffer.byteLength(name, 'utf8') <= 63;
type NativeHistoryGaps = Array<DataNativePostgresHistory['gaps'][number]>;

async function legacyDsn(box: string | null, cipher: SecretCipher, applicable = true): Promise<DataNativePostgresDsn> {
  const ciphertextDigest = box === null ? null : nativeHistoryDigest(box);
  if (!applicable) return { state: 'not-applicable', ciphertextDigest, origin: null };
  if (box === null) return { state: 'absent', ciphertextDigest, origin: null };
  let plain: string;
  try { plain = await cipher.decrypt(box); } catch { return { state: 'unreadable', ciphertextDigest, origin: null }; }
  try {
    const url = new URL(plain), path = /^(?:postgres|postgresql):\/\/[^/?#]+\/([^?#]*)$/.exec(plain)?.[1];
    const database = path === undefined ? '' : decodeURIComponent(path), role = decodeURIComponent(url.username);
    // URI query parameters can override host/user/dbname. Unsupported forms are a gap, never a guessed endpoint.
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || /[,/%\\]/.test(url.hostname) || url.search || url.hash || !nativeHistoryName(database) || !nativeHistoryName(role)) throw new Error('invalid origin');
    const port = url.port ? Number(url.port) : 5432;
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('invalid port');
    return { state: 'available', ciphertextDigest, origin: { hostname: url.hostname, port, database, role } };
  } catch { return { state: 'invalid', ciphertextDigest, origin: null }; }
}

function legacyDsnGaps(gaps: NativeHistoryGaps, source: 'resource' | 'binding', id: string, dsn: DataNativePostgresDsn): void {
  if (dsn.state === 'unreadable') gaps.push({ source, id, code: 'legacy-dsn-unreadable', message: '保留的原连接串无法解密，不能确认原生来源' });
  if (dsn.state === 'invalid') gaps.push({ source, id, code: 'legacy-dsn-invalid', message: '保留的连接串来源不明确或不受支持，不能确认原生来源' });
}

/** Read-only original legacy declarations; never calls envFor, credentials, projection or provider. */
export function nativePostgresHistoryUseCases(store: NativePostgresHistoryStore, cipher: SecretCipher) {
  return { read: async (projectId: ProjectId): Promise<DataNativePostgresHistory> => {
    const snapshot = await store.read(projectId), gaps: NativeHistoryGaps = [];
    const common = (row: (typeof snapshot.resources)[number] | (typeof snapshot.bindings)[number]) => {
      if (row.projectId !== projectId || !row.id || !row.serviceId || !Number.isFinite(row.createdAt.getTime()) || !Number.isFinite(row.updatedAt.getTime())) throw precondition('原生数据保留历史的原归属或时间格式不合法');
      return { id: row.id, serviceId: row.serviceId, state: row.state, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
    };
    const resources: Array<DataNativePostgresHistory['resources'][number]> = [];
    for (const row of snapshot.resources) {
      const dsn = await legacyDsn(row.secretBox, cipher, row.kind === 'postgres');
      if (!DataResourceKindSchema.safeParse(row.kind).success || !DataEnvSchema.safeParse(row.env).success || !DataResourceStateSchema.safeParse(row.state).success) gaps.push({ source: 'resource', id: row.id, code: 'legacy-row-invalid', message: '保留数据资源的种类、环境或状态不能解读' });
      if (row.kind === 'postgres' && !nativeHistoryName(row.objectName)) gaps.push({ source: 'resource', id: row.id, code: 'legacy-name-invalid', message: '保留数据库原名字不合法' });
      if (dsn.origin && dsn.origin.database !== row.objectName) gaps.push({ source: 'resource', id: row.id, code: 'legacy-dsn-conflict', message: '原连接串与保留数据库名字不一致' });
      legacyDsnGaps(gaps, 'resource', row.id, dsn);
      resources.push({ ...common(row), kind: row.kind, env: row.env, objectName: row.objectName, dsn });
    }
    const bindings: Array<DataNativePostgresHistory['bindings'][number]> = [];
    for (const row of snapshot.bindings) {
      const dsn = await legacyDsn(row.secretBox, cipher);
      if (!row.taskId || !TaskDataModeSchema.safeParse(row.mode).success || !TaskDataBindingStateSchema.safeParse(row.state).success) gaps.push({ source: 'binding', id: row.id, code: 'legacy-row-invalid', message: '保留访问绑定的原任务、模式或状态不能解读' });
      if (row.expiresAt !== null && !Number.isFinite(row.expiresAt.getTime())) throw precondition('原生数据保留历史的有效期格式不合法');
      const sharedDevelopment = row.mode === 'development' && row.roleName === 'development';
      if (row.roleName !== null && !sharedDevelopment && (!nativeHistoryName(row.roleName) || row.roleName === 'development')) gaps.push({ source: 'binding', id: row.id, code: 'legacy-name-invalid', message: '保留临时角色原名字不合法' });
      if (dsn.origin && row.roleName !== null && !sharedDevelopment && dsn.origin.role !== row.roleName) gaps.push({ source: 'binding', id: row.id, code: 'legacy-dsn-conflict', message: '原连接串与保留临时角色名字不一致' });
      legacyDsnGaps(gaps, 'binding', row.id, dsn);
      bindings.push({ ...common(row), taskId: row.taskId, legacyResourceId: row.legacyResourceId, mode: row.mode, roleName: row.roleName, expiresAt: row.expiresAt?.toISOString() ?? null, dsn });
    }
    const aliases = nativeAliases(snapshot.aliases, resources, bindings, gaps);
    const revision = nativeHistoryDigest(JSON.stringify({ version: 2, projectId, resources, bindings, aliases, gaps }));
    return { projectId, retainedRecordsComplete: true, revision, resources, bindings, aliases, gaps };
  } };
}
function nativeAliases(rows: Awaited<ReturnType<NativePostgresHistoryStore['read']>>['aliases'], resources: DataNativePostgresHistory['resources'], bindings: DataNativePostgresHistory['bindings'], gaps: NativeHistoryGaps): DataNativePostgresHistory['aliases'] {
  const resourceIds = new Set(resources.map((row) => row.id)), bindingIds = new Set(bindings.map((row) => row.id));
  return rows.map((row) => {
    const kind = row.kind === 'data-resource' || row.kind === 'data-binding' ? row.kind : 'unknown';
    let keys: unknown; try { keys = JSON.parse(row.key); } catch { keys = null; }
    const valid = kind !== 'unknown' && (kind === 'data-resource' ? resourceIds : bindingIds).has(row.id) && Array.isArray(keys) && keys.length === 1 && typeof keys[0] === 'string' && keys[0].length > 0 && keys[0].length <= 512 && !keys[0].includes('://');
    if (!valid) gaps.push({ source: 'alias', id: row.id, code: 'legacy-alias-invalid', message: '保留身份别名的种类、原键或本项目归属不能完整解读' });
    return { kind, id: row.id, valid, keys: valid ? keys as string[] : [] };
  });
}

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
    abandon: store.abandon,
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
