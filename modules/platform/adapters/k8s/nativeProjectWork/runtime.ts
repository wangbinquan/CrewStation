import { jsonHash, precondition } from '@crewstation/kernel';
import type { ProjectDeletionContext, ProjectDeletionTarget } from '@crewstation/contracts';
import { nativePodWork, podWorkIdentity } from './pods';
import type { NativeWorkOptions, PodWorkHistory, RuntimeWorkSource } from './bindings';

interface Original { version: 1; projectId: string; work: PodWorkHistory }
const report = { complete: true, blockers: [], references: [] };
export function nativeRuntimeProjectWork(options: NativeWorkOptions): RuntimeWorkSource {
  const pods = nativePodWork(options);
  const original = (raw: Parameters<RuntimeWorkSource['inspect']>[0]): Original => {
    const body = raw.body as Original;
    if (body?.version !== 1 || body.projectId !== body.work?.catalog.target.id || raw.identity !== podWorkIdentity(body.work) || raw.epoch !== jsonHash(body.work.nodes.map(row => row.source))) throw precondition('原运行镜像工作出生或留存物理材料变化');
    return structuredClone(body);
  };
  const proof = async (context: ProjectDeletionContext, raw: Parameters<RuntimeWorkSource['inspect']>[0]) => {
    const body = original(raw); await options.project().assertProjectDeletionGrant(context);
    if (context.target.id !== body.projectId || context.confirmed.participant !== 'runtime-environment') throw precondition('原运行镜像实际工作许可不符');
    const actual = await pods.inspect(body.work); await options.project().assertProjectDeletionGrant(context);
    return { kind: 'done' as const, scopeDigest: jsonHash(raw), sourceIdentity: raw.identity, independent: true, producersClosed: true,
      consumersStopped: actual.nativeRemaining === 0, ...actual, callbackExits: [] };
  };
  return {
    capture: async (target: ProjectDeletionTarget, content) => {
      const work = await pods.capture({ mode: 'runtime-environment', target, consumerIds: content.consumers.map(row => row.id) }, content.callbacks.map(row => row.process));
      const body: Original = { version: 1, projectId: target.id, work }, identity = podWorkIdentity(work), epoch = jsonHash(work.nodes.map(row => row.source));
      const objects = work.catalog.objects.map(row => ({ kind: row.kind === 'Secret' || row.kind === 'ConfigMap' ? 'credential' as const : 'builder' as const, id: 'native-object:' + row.uid, identity: row.identity, sourceIdentity: identity, count: 1 }));
      return { ...report, native: { identity, epoch, body, objects } };
    },
    inspect: async raw => { await pods.inspect(original(raw).work); return report; },
    stop: async (context, raw) => { const stopped = await pods.stop(context, original(raw).work); return stopped.kind === 'done' ? proof(context, raw) : stopped; },
    purge: async (context, raw) => { await pods.purge(context, original(raw).work); return proof(context, raw); },
    prove: proof, callbackExit: row => pods.callbackExit(row.process),
  };
}
