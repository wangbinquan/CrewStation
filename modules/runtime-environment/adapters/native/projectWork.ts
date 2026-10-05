import { ProjectDeletionTargetSchema, ProjectDeletionNativeProofSchema } from '@crewstation/contracts';
import type { ProjectDeletionContext } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Database } from '@crewstation/persistence';
import { RUNTIME_IMAGE_PHYSICAL_KINDS, RuntimeImagePhysicalScopeSchema, runtimeImageCallbackReceipt, runtimeImagePhysicalOrigins } from '../../domain/records';
import type { RuntimeImageProjectContent } from '../../ports/repositories';
import type { RuntimeImageDeletionPhysics, RuntimeImagePhysicalScope } from '../../ports/projectDeletion';
import type { RuntimeImageNativeWorkSnapshot, RuntimeImageNativeWorkSource } from '../../ports/nativeProjectWork';
import { runtimeImageDeletionRepository } from '../persistence/projectDeletion';

interface Body { version: 1; target: ProjectDeletionContext['target']; content: RuntimeImageProjectContent; native: RuntimeImageNativeWorkSnapshot }
function scopeFor(body: Body): RuntimeImagePhysicalScope {
  const { target, content, native } = body, source = { identity: native.identity, epoch: native.epoch, version: 'runtime-original-work/1' };
  const bindings = content.inventory.resources.filter(row => row.scope === 'physical').map(row => {
    const kind = row.kind === 'runtime-image:build' ? 'builder' as const : row.kind === 'runtime-image:validation' ? 'validation' as const : undefined;
    if (!kind) throw precondition('运行镜像存在不能绑定的原物理消费者');
    return { kind, id: 'consumer:' + row.id, identity: row.identity, sourceIdentity: native.identity, count: row.count,
      consumerId: row.id, consumerIdentity: row.sourceIdentity ?? row.identity };
  });
  const callbacks = content.callbacks.map(row => ({ kind: 'callback' as const, id: 'callback:' + row.id, identity: runtimeImageCallbackReceipt(row),
    sourceIdentity: native.identity, count: 1, consumerId: row.id, consumerIdentity: runtimeImageCallbackReceipt(row) }));
  return RuntimeImagePhysicalScopeSchema.parse({ version: 1, projectId: target.id, originDigest: runtimeImagePhysicalOrigins(target.id, content.inventory.resources, content.callbacks), source,
    nativeHistory: { version: 1, identity: source.identity, digest: jsonHash(body), body }, objects: [...native.objects, ...bindings, ...callbacks],
    coverage: RUNTIME_IMAGE_PHYSICAL_KINDS.map(kind => ({ kind, identity: jsonHash({ native: native.identity, kind, objects: native.objects.filter(row => row.kind === kind) }), complete: true })) });
}
function original(raw: RuntimeImagePhysicalScope): Body {
  const scope = RuntimeImagePhysicalScopeSchema.parse(raw), body = scope.nativeHistory?.body as Body | undefined;
  if (!body || body.version !== 1 || !body.content || !body.native || jsonHash(scopeFor(body)) !== jsonHash(scope)) throw precondition('运行镜像缺少完整留存的原工作范围');
  ProjectDeletionTargetSchema.parse(body.target); return structuredClone(body);
}

/** The module binds its complete original consumer inputs and reads its own
 * durable callback exits. Native Pod/cache/files remain independent sources. */
export function nativeRuntimeImageWorkPhysics(input: { db: Database; source: RuntimeImageNativeWorkSource;
  assertGrant(context: ProjectDeletionContext): Promise<void>;
}): RuntimeImageDeletionPhysics {
  const repository = runtimeImageDeletionRepository(input);
  const prove = async (scope: RuntimeImagePhysicalScope, supplied?: ProjectDeletionContext, action: 'stop' | 'purge' | 'prove' = 'prove') => {
    if (!supplied) throw precondition('运行镜像独立复盘缺少当前持久删除许可');
    const body = original(scope), context = supplied; await input.assertGrant(context);
    const stored = await repository.load(context);
    if (!stored.verified || context.target.id !== body.target.id || context.confirmed.participant !== 'runtime-environment') throw precondition('运行镜像原工作没有经过封写确认');
    const combined = stored.scope.physical?.nativeHistory?.body as { version?: number; work?: unknown } | undefined;
    if (jsonHash(combined?.version === 1 && combined.work ? combined.work : stored.scope.physical) !== jsonHash(scope)) throw precondition('运行镜像原工作与持久确认范围不符');
    const native = ProjectDeletionNativeProofSchema.parse(await input.source[action](context, body.native)); if (native.kind !== 'done') return native;
    if (native.sourceIdentity !== body.native.identity || native.scopeDigest !== jsonHash(body.native)) throw precondition('原运行镜像原生证明没有绑定留存工作出生');
    const current = await repository.content(body.target), callbackExits = [];
    for (const birth of body.content.callbacks) {
      const identity = runtimeImageCallbackReceipt(birth), row = current.callbacks.find(candidate => candidate.id === birth.id);
      if (row && runtimeImageCallbackReceipt(row) !== identity) throw precondition('运行镜像原回调输入或进程身份变化');
      let digest = row?.exited ? row.exitDigest : undefined;
      if (!row && stored.receipts.metadata && stored.receipts.stop) digest = jsonHash({ original: identity, stop: stored.receipts.stop, metadata: stored.receipts.metadata });
      digest ??= await input.source.callbackExit(birth);
      if (!digest) return { kind: 'waiting' as const, reason: '等待原运行镜像回调的实际 finally 或原受保护进程退出' };
      callbackExits.push({ id: birth.id, originalIdentity: identity, digest });
    }
    await input.assertGrant(context);
    return { ...native, digest: jsonHash({ native: native.digest, callbacks: callbackExits }), sourceIdentity: scope.source.identity, scopeDigest: jsonHash(scope), callbackExits };
  };
  return {
    capture: async (raw, content) => {
      const target = ProjectDeletionTargetSchema.parse(raw), captured = await input.source.capture(target, content);
      const body = JSON.parse(JSON.stringify({ version: 1, target, content, native: captured.native })) as Body;
      return { complete: captured.complete, blockers: captured.blockers, references: captured.references, scope: scopeFor(body) };
    },
    inspect: raw => input.source.inspect(original(raw).native),
    stop: (context, scope) => prove(scope, context, 'stop'), purge: (context, scope) => prove(scope, context, 'purge'), prove: (scope, context) => prove(scope, context),
  };
}
