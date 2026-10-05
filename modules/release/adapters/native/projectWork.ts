import { ProjectDeletionTargetSchema, ProjectDeletionNativeProofSchema } from '@crewstation/contracts';
import type { ProjectDeletionContext } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import { RELEASE_PHYSICAL_KINDS, ReleasePhysicalScopeSchema, releaseCallbackIdentity } from '../../domain/release';
import type { ReleaseDeletionContent, ReleasePhysicalScope } from '../../domain/release';
import type { ReleaseDeletionPhysics } from '../../ports/unitOfWork';
import type { ReleaseNativeWorkSnapshot, ReleaseNativeWorkSource } from '../../ports/nativeProjectWork';
import { releaseDeletionRepository } from '../persistence/projectDeletion';

interface Body { version: 1; target: ProjectDeletionContext['target']; content: ReleaseDeletionContent; native: ReleaseNativeWorkSnapshot }
function scopeFor(body: Body): ReleasePhysicalScope {
  const { target, content, native } = body, source = { identity: native.identity, epoch: native.epoch, version: 'release-original-work/1' };
  const bindings = content.consumers.map(({ kind, id, identity }) => ({ kind, id, identity })).sort((a, b) => (a.kind + ':' + a.id).localeCompare(b.kind + ':' + b.id));
  return ReleasePhysicalScopeSchema.parse({ version: 1, projectId: target.id, originDigest: jsonHash({ projectId: target.id, bindings, identityLinks: content.identityLinks }), source, bindings,
    nativeHistory: { version: 1, identity: source.identity, digest: jsonHash(body), body }, objects: native.objects,
    coverage: RELEASE_PHYSICAL_KINDS.map(kind => ({ kind, identity: jsonHash({ native: native.identity, kind, objects: native.objects.filter(row => row.kind === kind) }), complete: true })) });
}
function original(raw: ReleasePhysicalScope): Body {
  const scope = ReleasePhysicalScopeSchema.parse(raw), body = scope.nativeHistory?.body as Body | undefined;
  if (!body || body.version !== 1 || !body.content || !body.native || jsonHash(scopeFor(body)) !== jsonHash(scope)) throw precondition('发布缺少完整留存的原工作范围');
  ProjectDeletionTargetSchema.parse(body.target); return structuredClone(body);
}

/** Bind all old releases/slots/migrations/handoffs and independently retained
 * native material. Read callback finally receipts through this module's DB. */
export function nativeReleaseWorkPhysics(input: Parameters<typeof releaseDeletionRepository>[0] & {
  source: ReleaseNativeWorkSource;
}): ReleaseDeletionPhysics {
  const repository = releaseDeletionRepository(input);
  const prove = async (scope: ReleasePhysicalScope, supplied?: ProjectDeletionContext, action: 'stop' | 'purge' | 'prove' = 'prove') => {
    if (!supplied) throw precondition('发布独立复盘缺少当前持久删除许可');
    const body = original(scope), context = supplied; await input.assertGrant(context);
    const stored = await repository.load(context);
    if (!stored.verified || context.target.id !== body.target.id || context.confirmed.participant !== 'release') throw precondition('发布原工作没有经过封写确认');
    const combined = stored.scope.physical?.nativeHistory?.body as { version?: number; work?: unknown } | undefined;
    if (jsonHash(combined?.version === 1 && combined.work ? combined.work : stored.scope.physical) !== jsonHash(scope)) throw precondition('发布原工作与持久确认范围不符');
    const native = ProjectDeletionNativeProofSchema.parse(await input.source[action](context, body.native)); if (native.kind !== 'done') return native;
    if (native.sourceIdentity !== body.native.identity || native.scopeDigest !== jsonHash(body.native)) throw precondition('原发布原生证明没有绑定留存工作出生');
    const current = await repository.content(body.target), callbackExits = [];
    for (const birth of body.content.callbacks) {
      const identity = releaseCallbackIdentity(birth), row = current.callbacks.find(candidate => candidate.id === birth.id);
      if (row && releaseCallbackIdentity(row) !== identity) throw precondition('发布原回调输入或进程身份变化');
      let digest = row?.exited ? row.exitDigest : undefined;
      if (!row && stored.receipts.metadata && stored.receipts.stop) digest = jsonHash({ original: identity, stop: stored.receipts.stop, metadata: stored.receipts.metadata });
      digest ??= await input.source.callbackExit(birth);
      if (!digest) return { kind: 'waiting' as const, reason: '等待原发布回调的实际 finally 或原受保护进程退出' };
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
