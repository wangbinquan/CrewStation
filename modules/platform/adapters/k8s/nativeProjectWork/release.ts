import type { ProjectDeletionContext } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import { nativePodWork, podWorkIdentity } from './pods';
import { nativeBuildKitProjectWork } from './buildKit';
import type { BuildKitWorkOptions } from './buildKit';
import type { BuildKitWorkHistory } from './buildKitSelection';
import type { PodWorkHistory, ReleaseWorkSource } from './bindings';

interface Original { version: 1; projectId: string; pods: PodWorkHistory; cache: BuildKitWorkHistory }
const identity = (body: Original) => jsonHash({ pods: podWorkIdentity(body.pods), cache: body.cache.source.identity, selection: body.cache.selectionIdentity,
  files: body.cache.originalFiles, consumers: body.cache.consumers });
const epoch = (body: Original) => jsonHash({ pods: body.pods.nodes.map(row => row.source), cache: body.cache.source.origin });
const report = { complete: true, blockers: [], references: [] };
export function nativeReleaseProjectWork(options: BuildKitWorkOptions): ReleaseWorkSource {
  const pods = nativePodWork(options), cache = nativeBuildKitProjectWork(options);
  const original = (raw: Parameters<ReleaseWorkSource['inspect']>[0]) => {
    const body = raw.body as Original;
    if (body?.version !== 1 || body.projectId !== body.pods?.catalog.target.id || raw.identity !== identity(body) || raw.epoch !== epoch(body)) throw precondition('原发布工作或共享缓存留存出生变化');
    return structuredClone(body);
  };
  const proof = async (context: ProjectDeletionContext, raw: Parameters<ReleaseWorkSource['inspect']>[0]) => {
    const body = original(raw); await options.project().assertProjectDeletionGrant(context);
    if (context.target.id !== body.projectId || context.confirmed.participant !== 'release') throw precondition('原发布原生回收许可不符');
    const work = await pods.inspect(body.pods), shared = await cache.inspect(body.cache); await options.project().assertProjectDeletionGrant(context);
    return { kind: 'done' as const, sourceIdentity: raw.identity, scopeDigest: jsonHash(raw), independent: true, producersClosed: true,
      consumersStopped: work.nativeRemaining + shared.nativeRemaining === 0, nativeRemaining: work.nativeRemaining + shared.nativeRemaining,
      storageRemaining: work.storageRemaining + shared.storageRemaining, digest: jsonHash({ work, shared: shared.digest }), callbackExits: [] };
  };
  return {
    capture: async (target, content) => {
      const body: Original = { version: 1, projectId: target.id,
        pods: await pods.capture({ mode: 'release', target, consumerIds: content.consumers.flatMap(row => [row.id, ...row.aliases]) }, content.callbacks.map(row => row.process)),
        cache: await cache.capture(target, content) };
      const sourceIdentity = identity(body), sourceEpoch = epoch(body);
      const objects = body.pods.catalog.objects.map(row => ({ kind: row.kind === 'Secret' || row.kind === 'ConfigMap' ? 'credential' as const : 'builder' as const,
        id: 'native-object:' + row.uid, identity: row.identity, sourceIdentity: jsonHash({ epoch: sourceEpoch, kind: row.kind, uid: row.uid, identity: row.identity }), count: 1 }));
      objects.push({ kind: 'builder', id: 'buildkit-work:' + target.id, identity: body.cache.selectionIdentity,
        sourceIdentity: jsonHash({ epoch: sourceEpoch, projectId: target.id, selection: body.cache.selectionIdentity }), count: body.cache.cacheIds.length + body.cache.selection.histories.length + body.cache.originalFiles.length });
      return { ...report, native: { identity: sourceIdentity, epoch: sourceEpoch, body, objects } };
    },
    inspect: async raw => { const body = original(raw); await pods.inspect(body.pods); await cache.inspect(body.cache); return report; },
    stop: async (context, raw) => { const body = original(raw), result = await pods.stop(context, body.pods); return result.kind === 'done' ? proof(context, raw) : result; },
    purge: async (context, raw) => { const body = original(raw); await pods.purge(context, body.pods); const result = await cache.purge(context, body.cache); return result.kind === 'waiting' ? result : proof(context, raw); },
    prove: proof, callbackExit: row => pods.callbackExit(row.process),
  };
}
