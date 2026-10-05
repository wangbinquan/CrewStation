import { ProjectDeletionContextSchema, ProjectDeletionNativeProofSchema, ProjectDeletionTargetSchema } from '@crewstation/contracts';
import type { NativeRegistryDeletionSource } from '@crewstation/contracts';
import { captureRegistryHistory, createRegistryReclamationClient, registryHistoryIdentity, validateRegistryHistoryObservation } from '@crewstation/filesystem-metrics';
import type { RegistryDeletionHistory } from '@crewstation/filesystem-metrics';
import { jsonHash, precondition } from '@crewstation/kernel';
import { ReleasePhysicalScopeSchema } from '../../domain/release';
import type { ReleasePhysicalScope } from '../../domain/release';
import type { ReleaseDeletionPhysics, ReleasePhysicalProof } from '../../ports/unitOfWork';

function combined(work: ReleasePhysicalScope, registry: RegistryDeletionHistory): ReleasePhysicalScope {
  const body = { version: 1, work, registry }, identity = jsonHash({ work: work.source.identity, registry: registry.sourceIdentity });
  return ReleasePhysicalScopeSchema.parse({ ...work,
    source: { identity, epoch: jsonHash({ work: work.source.epoch, root: registry.original.rootIdentity, volume: registry.original.volumeIdentity }), version: 'release-native-registry/1' },
    nativeHistory: { version: 1, identity, digest: jsonHash(body), body },
    objects: [...work.objects, { kind: 'artifact', id: 'registry-history:' + work.projectId, identity: registryHistoryIdentity(registry), sourceIdentity: registry.sourceIdentity, count: registry.original.entries.length + registry.original.blobs.length }],
    coverage: work.coverage.map(row => row.kind === 'artifact' ? { ...row, identity: jsonHash({ native: row.identity, registry: registryHistoryIdentity(registry) }) } : row),
  });
}
function materials(raw: ReleasePhysicalScope) {
  const scope = ReleasePhysicalScopeSchema.parse(raw), body = scope.nativeHistory?.body as { version?: unknown; work?: unknown; registry?: unknown } | undefined;
  if (!body || body.version !== 1 || !body.work || !body.registry) throw precondition('发布缺少留存的原构建、缓存与 Registry 材料');
  const work = ReleasePhysicalScopeSchema.parse(body.work), registry = captureRegistryHistory(body.registry as RegistryDeletionHistory);
  if (registry.projectId !== scope.projectId || work.projectId !== scope.projectId || jsonHash(combined(work, registry)) !== jsonHash(scope)) throw precondition('发布原物理范围或原 Registry 身份变化');
  return { scope, work, registry };
}
function workProof(scope: ReleasePhysicalScope, raw: ReleasePhysicalProof) {
  const proof = ProjectDeletionNativeProofSchema.parse(raw); if (proof.kind !== 'done') return proof;
  if (proof.scopeDigest !== jsonHash(scope) || proof.sourceIdentity !== scope.source.identity) throw precondition('发布原构建证明没有绑定留存范围');
  if (scope.bindings.some(row => row.kind === 'callback' && !proof.callbackExits.some(exit => exit.id === row.id && exit.originalIdentity === row.identity))) throw precondition('发布原回调缺少匹配的实际退出回执');
  if (!proof.independent || !proof.producersClosed || !proof.consumersStopped || proof.nativeRemaining) return { kind: 'waiting' as const, reason: '等待原发布生产者封闭及全部构建、迁移、槽和回调实际退出' };
  return proof;
}
function originalContext(raw: Parameters<ReleaseDeletionPhysics['purge']>[0], scope: ReleasePhysicalScope, phase: 'stop' | 'purge') {
  const context = ProjectDeletionContextSchema.parse(raw);
  if (context.target.id !== scope.projectId || context.confirmed.participant !== 'release' || context.phase !== phase) throw precondition('发布原阶段或项目许可变化');
  if (!context.confirmed.complete || context.confirmed.blockers.length || context.confirmed.references.length
    || scope.objects.some(object => !context.confirmed.resources.some(row => row.kind === 'release-native:' + object.kind && row.id === object.id && row.identity === object.identity
      && row.sourceIdentity === object.sourceIdentity && row.count === object.count && row.scope === 'physical'))) throw precondition('发布许可没有确认全部原物理材料');
  return context;
}
function manifests(reference: string, registryBase: string, repository: string) {
  if (!reference.startsWith(registryBase + '/')) throw precondition('原发布制品不属于受管 Registry');
  const value = reference.slice(registryBase.length + 1), match = /^([a-z0-9]+(?:[._-][a-z0-9]+)*)(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}|@(sha256:[a-f0-9]{64}))$/.exec(value);
  if (!match || match[1] !== repository) throw precondition('原发布制品缺少本项目原仓库归属');
  return match[2] ? [match[2]] : [];
}

/** Retained native build/cache scope and actual original Registry byte graph. */
export function releaseRegistryDeletionPhysics(input: { work: ReleaseDeletionPhysics; artifacts: NativeRegistryDeletionSource; registryBase: string;
  transport: Parameters<typeof createRegistryReclamationClient>[0]; assertGrant(context: Parameters<ReleaseDeletionPhysics['purge']>[0]): Promise<void>;
}): ReleaseDeletionPhysics {
  if (!input.registryBase || /[\s/?#@]/.test(input.registryBase)) throw precondition('发布原 Registry 基址无效');
  const client = createRegistryReclamationClient(input.transport), registryBase = input.registryBase;
  const observe = async (scope: ReleasePhysicalScope, proof: ReleasePhysicalProof, stopOnly = false): Promise<ReleasePhysicalProof> => {
    const original = materials(scope), checked = workProof(original.work, proof); if (checked.kind !== 'done') return checked;
    const current = validateRegistryHistoryObservation(original.registry, await input.artifacts.inspect(original.registry));
    if (current.consumerCount || !stopOnly && (checked.storageRemaining || current.native || current.storage)) return { kind: 'waiting', reason: '原发布独占制品、构建缓存或文件消费者尚未完整回收' };
    return { ...checked, sourceIdentity: original.scope.source.identity, scopeDigest: jsonHash(original.scope), nativeRemaining: current.consumerCount,
      storageRemaining: checked.storageRemaining + current.native + current.storage,
      digest: jsonHash({ work: checked.digest, registry: registryHistoryIdentity(original.registry), inventory: current.inventory, consumers: current.consumerDigest }) };
  };
  return {
    capture: async (rawTarget, rawContent) => {
      const target = ProjectDeletionTargetSchema.parse(rawTarget), content = structuredClone(rawContent), captured = await input.work.capture(target, content); if (!captured.scope) return captured;
      const work = ReleasePhysicalScopeSchema.parse(captured.scope);
      if (work.projectId !== target.id) throw precondition('发布原构建范围属于其他项目');
      const query = { exact: [target.slug], prefixes: [], retainedDigests: [], retainedManifests: [...new Set(content.artifacts?.flatMap(row => manifests(row.reference, registryBase, target.slug)) ?? [])].sort() };
      const registry = captureRegistryHistory(await input.artifacts.capture(target.id, query) as RegistryDeletionHistory);
      const { key: _key, rootId: _root, directory: _directory, ...actualQuery } = registry.query;
      if (registry.projectId !== target.id || jsonHash(actualQuery) !== jsonHash(query)) throw precondition('发布原 Registry 材料或完整仓库范围变化');
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
      if (work.storageRemaining) return { kind: 'waiting', reason: '原发布构建缓存或临时文件仍未回收' };
      validateRegistryHistoryObservation(original.registry, await input.artifacts.inspect(original.registry)); await input.assertGrant(context); await client.reclaim(context, original.registry);
      const result = await observe(original.scope, await input.work.prove(original.work)); await input.assertGrant(context); return result;
    },
    prove: async raw => { const original = materials(raw); return observe(original.scope, await input.work.prove(original.work)); },
  };
}
