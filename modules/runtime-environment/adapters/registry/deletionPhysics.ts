import { ProjectDeletionContextSchema, ProjectDeletionTargetSchema, ProjectDeletionNativeProofSchema } from '@crewstation/contracts';
import type { NativeRegistryDeletionSource } from '@crewstation/contracts';
import { captureRegistryHistory, createRegistryReclamationClient, registryHistoryIdentity, validateRegistryHistoryObservation } from '@crewstation/filesystem-metrics';
import type { RegistryDeletionHistory } from '@crewstation/filesystem-metrics';
import { jsonHash, precondition } from '@crewstation/kernel';
import { RuntimeImagePhysicalScopeSchema } from '../../domain/records';
import type { RuntimeImageDeletionPhysics, RuntimeImagePhysicalScope, RuntimeImagePhysicalProof } from '../../ports/projectDeletion';

function combined(work: RuntimeImagePhysicalScope, registry: RegistryDeletionHistory): RuntimeImagePhysicalScope {
  const body = { version: 1, work, registry }, identity = jsonHash({ work: work.source.identity, registry: registry.sourceIdentity });
  return RuntimeImagePhysicalScopeSchema.parse({ ...work,
    source: { identity, epoch: jsonHash({ work: work.source.epoch, root: registry.original.rootIdentity, volume: registry.original.volumeIdentity }), version: 'runtime-native-registry/1' },
    nativeHistory: { version: 1, identity, digest: jsonHash(body), body },
    objects: [...work.objects, { kind: 'artifact', id: 'registry-history:' + work.projectId, identity: registryHistoryIdentity(registry), sourceIdentity: registry.sourceIdentity, count: registry.original.entries.length + registry.original.blobs.length }],
    coverage: work.coverage.map(row => row.kind === 'artifact' ? { ...row, identity: jsonHash({ native: row.identity, registry: registryHistoryIdentity(registry) }) } : row),
  });
}
function materials(raw: RuntimeImagePhysicalScope) {
  const scope = RuntimeImagePhysicalScopeSchema.parse(raw), body = scope.nativeHistory?.body as { version?: unknown; work?: unknown; registry?: unknown } | undefined;
  if (!body || body.version !== 1 || !body.work || !body.registry) throw precondition('运行镜像缺少留存的原构建与 Registry 材料');
  const work = RuntimeImagePhysicalScopeSchema.parse(body.work), registry = captureRegistryHistory(body.registry as RegistryDeletionHistory);
  if (registry.projectId !== scope.projectId || work.projectId !== scope.projectId || jsonHash(combined(work, registry)) !== jsonHash(scope)) throw precondition('运行镜像原物理范围或原 Registry 身份变化');
  return { scope, work, registry };
}
function workProof(scope: RuntimeImagePhysicalScope, raw: RuntimeImagePhysicalProof) {
  const proof = ProjectDeletionNativeProofSchema.parse(raw);
  if (proof.kind !== 'done') return proof;
  if (proof.scopeDigest !== jsonHash(scope) || proof.sourceIdentity !== scope.source.identity) throw precondition('运行镜像原构建证明没有绑定留存范围');
  if (scope.objects.some(row => row.kind === 'callback' && row.consumerId && !proof.callbackExits.some(exit => exit.id === row.consumerId && exit.originalIdentity === row.consumerIdentity))) throw precondition('运行镜像原回调缺少匹配的实际退出回执');
  if (!proof.independent || !proof.producersClosed || !proof.consumersStopped || proof.nativeRemaining) return { kind: 'waiting' as const, reason: '等待原运行镜像生产者封闭及全部构建、验证和回调实际退出' };
  return proof;
}
function originalContext(raw: Parameters<RuntimeImageDeletionPhysics['purge']>[0], scope: RuntimeImagePhysicalScope, phase: 'stop' | 'purge') {
  const context = ProjectDeletionContextSchema.parse(raw);
  if (context.target.id !== scope.projectId || context.confirmed.participant !== 'runtime-environment' || context.phase !== phase) throw precondition('运行镜像原阶段或项目许可变化');
  if (!context.confirmed.complete || context.confirmed.blockers.length || context.confirmed.references.length
    || scope.objects.some(object => !context.confirmed.resources.some(row => row.kind === 'runtime-native:' + object.kind && row.id === object.id && row.identity === object.identity
      && row.sourceIdentity === jsonHash({ nativeSource: object.sourceIdentity, consumerId: object.consumerId ?? null, consumerIdentity: object.consumerIdentity ?? null })
      && row.count === object.count && row.scope === 'physical'))) throw precondition('运行镜像许可没有确认全部原物理材料');
  return context;
}

/** Compose the actual native work/cache source with retained Registry files.
 * Neither a catalog retirement nor a private DELETE acknowledgement is proof. */
export function runtimeImageRegistryDeletionPhysics(input: { work: RuntimeImageDeletionPhysics; artifacts: NativeRegistryDeletionSource;
  transport: Parameters<typeof createRegistryReclamationClient>[0]; assertGrant(context: Parameters<RuntimeImageDeletionPhysics['purge']>[0]): Promise<void>;
}): RuntimeImageDeletionPhysics {
  const client = createRegistryReclamationClient(input.transport);
  const observe = async (scope: RuntimeImagePhysicalScope, proof: RuntimeImagePhysicalProof, stopOnly = false): Promise<RuntimeImagePhysicalProof> => {
    const original = materials(scope), checked = workProof(original.work, proof); if (checked.kind !== 'done') return checked;
    const current = validateRegistryHistoryObservation(original.registry, await input.artifacts.inspect(original.registry));
    if (current.consumerCount || !stopOnly && (checked.storageRemaining || current.native || current.storage)) return { kind: 'waiting', reason: '原运行镜像独占制品、缓存或文件消费者尚未完整回收' };
    return { ...checked, sourceIdentity: original.scope.source.identity, scopeDigest: jsonHash(original.scope), nativeRemaining: current.consumerCount,
      storageRemaining: checked.storageRemaining + current.native + current.storage,
      digest: jsonHash({ work: checked.digest, registry: registryHistoryIdentity(original.registry), inventory: current.inventory, consumers: current.consumerDigest }) };
  };
  return {
    capture: async (rawTarget, rawContent) => {
      const target = ProjectDeletionTargetSchema.parse(rawTarget), content = structuredClone(rawContent), captured = await input.work.capture(target, content);
      if (!captured.scope) return captured;
      const work = RuntimeImagePhysicalScopeSchema.parse(captured.scope), prefix = 'runtime/projects/' + target.id;
      if (work.projectId !== target.id || content.artifacts?.some(row => row.projectOwned && !row.repository.startsWith(prefix + '/'))) throw precondition('运行镜像原制品不属于本项目前缀');
      const own = content.artifacts?.filter(row => row.projectOwned) ?? [], protectedRepositories = [...new Set(content.artifacts?.filter(row => !row.projectOwned).map(row => row.repository) ?? [])].sort();
      const query = { exact: [], prefixes: [prefix], retainedDigests: [], retainedManifests: [...new Set(own.flatMap(row => row.digest ? [row.digest] : []))].sort(), protectedRepositories };
      const registry = captureRegistryHistory(await input.artifacts.capture(target.id, query) as RegistryDeletionHistory);
      const { key: _key, rootId: _root, directory: _directory, ...actualQuery } = registry.query;
      if (registry.projectId !== target.id || jsonHash(actualQuery) !== jsonHash(query)) throw precondition('运行镜像原 Registry 材料或完整前缀变化');
      return { ...captured, scope: combined(work, registry) };
    },
    inspect: async raw => { const original = materials(raw); validateRegistryHistoryObservation(original.registry, await input.artifacts.inspect(original.registry)); return input.work.inspect(original.work); },
    stop: async (rawContext, rawScope) => {
      const original = materials(rawScope), context = originalContext(rawContext, original.scope, 'stop'); await input.assertGrant(context);
      const result = await observe(original.scope, await input.work.stop(context, original.work), true); await input.assertGrant(context); return result;
    },
    purge: async (rawContext, rawScope) => {
      const original = materials(rawScope), context = originalContext(rawContext, original.scope, 'purge'); await input.assertGrant(context);
      const work = workProof(original.work, await input.work.purge(context, original.work)); if (work.kind !== 'done') return work;
      if (work.storageRemaining) return { kind: 'waiting', reason: '原运行镜像构建缓存或临时文件仍未回收' };
      validateRegistryHistoryObservation(original.registry, await input.artifacts.inspect(original.registry)); await input.assertGrant(context);
      await client.reclaim(context, original.registry);
      const result = await observe(original.scope, await input.work.prove(original.work, context)); await input.assertGrant(context); return result;
    },
    prove: async (raw, context) => { const original = materials(raw); return observe(original.scope, await input.work.prove(original.work, context)); },
  };
}
