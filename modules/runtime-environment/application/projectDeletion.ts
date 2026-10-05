import type { ProjectDeletionContext, ProjectDeletionInventory, ProjectDeletionOwner, ProjectDeletionStepResult, ProjectDeletionTarget } from '@crewstation/contracts';
import { PROJECT_DELETION_PHASES, ProjectDeletionBlockerSchema, ProjectDeletionContextSchema, ProjectDeletionInventorySchema, ProjectDeletionReferenceSchema, ResourceIdSchema } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import { z } from 'zod';
import { RuntimeImagePhysicalScopeSchema, runtimeImagePhysicalBindings } from '../domain/records';
import type { RuntimeImageProjectContent } from '../ports/repositories';
import type { RuntimeImageDeletionPhysics, RuntimeImageDeletionRepository, RuntimeImageDeletionScope, RuntimeImagePhysicalProof, RuntimeImagePhysicalScope } from '../ports/projectDeletion';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const reportSchema = z.object({ complete: z.boolean(), blockers: z.array(ProjectDeletionBlockerSchema), references: z.array(ProjectDeletionReferenceSchema) }).strict();
const proofSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('waiting'), reason: z.string().min(1).max(1000) }).strict(),
  z.object({ kind: z.literal('blocked'), blockers: z.array(ProjectDeletionBlockerSchema).min(1) }).strict(),
  z.object({ kind: z.literal('done'), digest: hash, scopeDigest: hash, sourceIdentity: hash, independent: z.boolean(), producersClosed: z.boolean(), consumersStopped: z.boolean(),
    nativeRemaining: z.number().int().nonnegative(), storageRemaining: z.number().int().nonnegative(), callbackExits: z.array(z.object({ id: ResourceIdSchema, originalIdentity: hash, digest: hash }).strict()) }).strict(),
]);
const blocker = (code: string, message: string) => ({ participant: 'runtime-environment' as const, code, message });
function physicalScope(raw: RuntimeImagePhysicalScope, target: ProjectDeletionTarget, content?: RuntimeImageProjectContent): RuntimeImagePhysicalScope {
  const scope = RuntimeImagePhysicalScopeSchema.parse(raw);
  if (scope.projectId !== target.id || content && !runtimeImagePhysicalBindings(scope, target.id, content.inventory.resources, content.callbacks)) throw precondition('运行镜像原物理范围没有绑定本项目原消费者');
  return scope;
}
function physicalResources(scope: RuntimeImagePhysicalScope | null): ProjectDeletionInventory['resources'] {
  if (!scope) return [];
  return [...scope.objects.map((entry) => ({ kind: 'runtime-native:' + entry.kind, id: entry.id, identity: entry.identity,
    sourceIdentity: jsonHash({ nativeSource: entry.sourceIdentity, consumerId: entry.consumerId ?? null, consumerIdentity: entry.consumerIdentity ?? null }), scope: 'physical' as const, count: entry.count })),
    ...scope.coverage.map((entry) => ({ kind: 'runtime-coverage:' + entry.kind, id: scope.projectId, identity: entry.identity, sourceIdentity: jsonHash(scope.source), scope: 'physical' as const, count: 0 }))]
    .sort((a, b) => (a.kind + ':' + a.id).localeCompare(b.kind + ':' + b.id));
}
const done = (kind: 'physical' | 'metadata' | 'not-applicable', digest: string, count: number): ProjectDeletionStepResult => ({ kind: 'done', evidence: { kind, digest, count,
  description: kind === 'physical' ? '原运行消费者、制品、缓存和凭据由独立来源按固定身份复核' : kind === 'metadata' ? '本项目运行环境准入、内容与原回调按持久阶段清理，平台目录和其他项目保留' : '项目命名空间由集群 owner 回收' } });
function physicalResult(scope: RuntimeImagePhysicalScope, raw: RuntimeImagePhysicalProof, stopOnly = false): ProjectDeletionStepResult {
  const proof = proofSchema.parse(raw);
  if (proof.kind !== 'done') return proof.kind === 'waiting' ? proof : { kind: 'blocked', blockers: proof.blockers };
  if (proof.scopeDigest !== jsonHash(scope) || proof.sourceIdentity !== scope.source.identity || new Set(proof.callbackExits.map((entry) => entry.id)).size !== proof.callbackExits.length) throw precondition('运行镜像独立证明没有绑定固定原范围');
  if (!proof.independent || !proof.producersClosed || !proof.consumersStopped) return { kind: 'blocked', blockers: [blocker('runtime-image-consumers-unproven', '运行镜像生产者封闭或原消费者实际退出尚未独立证明')] };
  if (proof.nativeRemaining !== 0 || !stopOnly && proof.storageRemaining !== 0) return { kind: 'waiting', reason: '原运行消费者或独占制品仍有残留，继续核对同一批原资源' };
  return done('physical', proof.digest, scope.objects.reduce((total, entry) => total + entry.count, 0));
}

export function runtimeImageProjectDeletionOwner(input: { repository: RuntimeImageDeletionRepository; physics: RuntimeImageDeletionPhysics; assertGrant(context: ProjectDeletionContext): Promise<void> }): ProjectDeletionOwner {
  const inspect = async (target: ProjectDeletionTarget) => {
    const retained = await input.repository.retained(target), content = await input.repository.content(target);
    const captured = retained?.physical ? { ...await input.physics.inspect(retained.physical), scope: retained.physical } : await input.physics.capture(target, content);
    const source = reportSchema.parse({ complete: captured.complete, blockers: captured.blockers, references: captured.references });
    const physical = captured.scope ? physicalScope(captured.scope, target, retained?.physical ? undefined : content) : null;
    const blockers = [...content.inventory.blockers, ...source.blockers, ...(!physical ? [blocker('runtime-image-native-source-missing', '运行镜像完整原生与存储来源缺失；空目录也不能当成独占制品已回收')] : [])];
    const references = [...content.inventory.references, ...source.references], resources = [...content.inventory.resources, ...physicalResources(physical)]
      .sort((a, b) => (a.kind + ':' + a.id).localeCompare(b.kind + ':' + b.id));
    const complete = content.inventory.complete && source.complete && physical !== null && blockers.length === 0 && references.length === 0;
    const report = ProjectDeletionInventorySchema.parse({ participant: 'runtime-environment', revision: jsonHash({ resources, contentRevision: content.inventory.revision, blockers, references, complete }), resources, references, blockers, complete });
    const scope: RuntimeImageDeletionScope = { version: 1, target: { projectId: target.id, namespace: target.namespace, ...(target.serviceId ? { serviceId: target.serviceId } : {}) }, inventory: report, content, physical };
    return { report, scope };
  };
  return { participant: 'runtime-environment', inspect: async (target) => (await inspect(target)).report, run: async (raw) => {
    const context = ProjectDeletionContextSchema.parse(raw);
    if (context.confirmed.participant !== 'runtime-environment' || !context.confirmed.complete || context.confirmed.blockers.length || context.confirmed.references.length) throw precondition('运行镜像永久清理许可没有完整确认');
    await input.assertGrant(context);
    if (context.phase === 'seal') {
      const current = await inspect(context.target), sealed = await input.repository.seal(context, current.scope);
      if (sealed === 'waiting') return { kind: 'waiting', reason: '等待本项目已开始的运行镜像回调退出，其他项目可继续工作' };
      if (!sealed) return { kind: 'blocked', blockers: [blocker('runtime-image-inventory-changed', '确认后运行镜像内容或原来源变化；已封闭准入，需重新核对')] };
    }
    const stored = await input.repository.load(context), previous = stored.receipts[context.phase];
    if (!stored.verified || !stored.scope.physical) throw precondition('运行镜像清理缺少已确认原范围');
    const scope = physicalScope(stored.scope.physical, context.target);
    if (previous) {
      if (context.phase === 'verify') {
        const result = physicalResult(scope, await input.physics.prove(scope, context)); await input.assertGrant(context);
        if (result.kind !== 'done') return result;
        await input.repository.advance(context, previous);
      }
      return { kind: 'done', evidence: previous };
    }
    if (stored.phaseIndex !== PROJECT_DELETION_PHASES.indexOf(context.phase) - 1) throw precondition('运行镜像清理缺少前一阶段回执');
    if (context.phase === 'seal' || context.phase === 'namespace') {
      const result = done(context.phase === 'seal' ? 'metadata' : 'not-applicable', jsonHash({ operationId: context.operationId, phase: context.phase, revision: context.confirmed.revision }), context.phase === 'seal' ? stored.scope.content.rows.length : 0);
      if (result.kind === 'done') await input.repository.advance(context, result.evidence); return result;
    }
    const proof = context.phase === 'stop' ? await input.physics.stop(context, scope) : context.phase === 'purge' ? await input.physics.purge(context, scope) : await input.physics.prove(scope, context);
    await input.assertGrant(context);
    const result = physicalResult(scope, proof, context.phase === 'stop');
    if (result.kind !== 'done') return result;
    if (context.phase === 'stop' && proof.kind === 'done') {
      await input.repository.recoverCallbacks(context, proof);
      if (!await input.repository.callbacksExited(context)) return { kind: 'waiting', reason: '原运行镜像回调尚未实际退出；租约或连接消失不能作为完成证明' };
    }
    if (context.phase === 'metadata') {
      return { kind: 'done', evidence: await input.repository.purgeMetadata(context) };
    }
    await input.repository.advance(context, result.evidence); return result;
  } };
}
