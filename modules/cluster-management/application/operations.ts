import { randomUUID } from 'node:crypto';
import type { Actor, ClusterInspection, ClusterInspectRequest, ClusterOperationRequest, ClusterResource } from '@crewstation/contracts';
import { conflict, notFound, precondition, validation } from '@crewstation/kernel';
import type { ResourceObject } from '../domain/inventory';
import { collectedKinds } from '../domain/inventory';
import { digest, projectResources } from '../domain/projection';
import type { ClusterDeps } from './dependencies';
import { readSnapshot, requireAdmin, resourceIn, relatedResources } from './queries';

export async function liveInspection(deps: ClusterDeps, actor: Actor, target: ClusterResource, request: ClusterInspectRequest): Promise<ClusterInspection> {
  await requireAdmin(deps, actor);
  if (request.action === 'scale' && request.replicas === undefined) throw validation('请输入目标副本数');
  if (request.action !== 'scale' && request.replicas !== undefined) throw validation('此操作不接受副本数');
  const facts = await deps.metadata.read(), objects: ResourceObject[] = [];
  if (!facts.complete) throw precondition('平台归属资料读取不完整');
  if (target.kind === 'Namespace') throw precondition('命名空间由项目和安装流程管理');
  const jobs = collectedKinds.filter((k) => k !== 'Namespace');
  await Promise.all(Array.from({ length: 4 }, async () => { for (;;) { const kind = jobs.shift(); if (!kind) break; try { objects.push(...(await deps.cluster.collect(kind, target.namespace, undefined, AbortSignal.timeout(30_000))).objects); } catch (e) { if (!e || typeof e !== 'object' || !('kind' in e) || e.kind !== 'not_found') throw precondition(`无法完成资源引用检查：${String(e)}`); } } }));
  const resources = projectResources(objects, facts, deps.systemNamespace, deps.catalog, deps.clock.now().toISOString());
  const row = resources.find((r) => r.uid === target.uid);
  if (!row) { if (resources.some((r) => r.kind === target.kind && r.name === target.name)) throw conflict('原实例已被同名新资源替换'); throw notFound('受管资源', target.name); }
  let capability = row.availableActions.find((a) => a.action === request.action)!;
  let domain;
  if (capability.enabled && capability.executionRoute !== 'kubernetes') { const result = await deps.domains.inspect(actor, row, request); capability = result.capability; domain = result.domain; }
  if (request.action === 'scale' && capability.enabled && (request.replicas! < (capability.minReplicas ?? 1) || request.replicas! > (capability.maxReplicas ?? 1))) throw validation(`副本数必须为 ${capability.minReplicas ?? 1}–${capability.maxReplicas ?? 1} 之间的整数`);
  const snapshot = { id: '', resources, facts, sources: [], startedAt: '', finishedAt: '' };
  return { inspectionId: randomUUID(), expiresAt: new Date(deps.clock.now().getTime() + 300_000).toISOString(), target: row, request, capability, related: relatedResources(snapshot, row).sort((a, b) => a.uid.localeCompare(b.uid)).map((r) => ({ uid: r.uid, name: r.name, kind: r.kind })), ...(domain ? { domain } : {}) };
}
export function sameInspection(old: ClusterInspection, current: ClusterInspection): void {
  if (old.target.uid !== current.target.uid || old.target.revision !== current.target.revision || old.target.domainRevision !== current.target.domainRevision || digest(old.related) !== digest(current.related) || digest(old.domain) !== digest(current.domain)) throw conflict('目标实例、相关资源或业务配置已变化，请重新检查');
  if (!current.capability.enabled) throw precondition(current.capability.reason);
}
export function operationUseCases(deps: ClusterDeps) {
  return {
    inspect: async (actor: Actor, id: string, request: ClusterInspectRequest) => {
      await requireAdmin(deps, actor); const row = resourceIn(await readSnapshot(deps), id);
      const inspection = await liveInspection(deps, actor, row, request);
      await deps.repository.saveInspection({ actorId: actor.userId, inspection }); return inspection;
    },
    accept: async (actor: Actor, request: ClusterOperationRequest) => {
      await requireAdmin(deps, actor);
      const old = (await deps.repository.operations({ idempotencyKey: request.idempotencyKey, limit: 1 }, actor.userId))[0];
      if (old) { if (old.inspectionId !== request.inspectionId || digest(old.params) !== digest(request.params)) throw conflict('同一幂等键不能用于不同操作'); return old; }
      const saved = await deps.repository.inspection(request.inspectionId);
      if (!saved || saved.actorId !== actor.userId) throw notFound('操作检查', request.inspectionId);
      const inspection = saved.inspection;
      if (Date.parse(inspection.expiresAt) <= deps.clock.now().getTime()) throw conflict('确认已过期，请重新检查');
      if (digest(inspection.request) !== digest(request.params)) throw conflict('操作参数与已检查内容不一致');
      if (!inspection.capability.enabled) throw precondition(inspection.capability.reason);
      sameInspection(inspection, await liveInspection(deps, actor, inspection.target, request.params));
      const now = deps.clock.now().toISOString();
      return deps.repository.accept({ operationId: randomUUID(), inspectionId: inspection.inspectionId, idempotencyKey: request.idempotencyKey, actorId: actor.userId, action: request.params.action, target: inspection.target, params: request.params, phase: 'queued', createdAt: now, updatedAt: now, durationMs: 0, traceId: randomUUID(), httpStatus: 202, reason: '已受理，等待执行' }, digest(request));
    },
  };
}
