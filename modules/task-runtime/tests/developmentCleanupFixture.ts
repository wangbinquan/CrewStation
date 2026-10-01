// Controlled digital participant for isolated job/UID regressions. The real SQLite-to-PG chain is in root E2E.
import { WORKLOAD_STOP_FINALIZER } from '@crewstation/contracts';
import { Resources } from '@crewstation/k8s';
import type { K8sObject } from '@crewstation/k8s';
import { conflict } from '@crewstation/kernel';
import { DevelopmentCleanupEvidenceSchema } from '../domain/development/cleanupEvidence';
import type { DevelopmentCleanupSelection } from '../domain/development/cleanupEvidence';
import type { TaskEnvironment } from '../domain/taskEnvironment';
import { developmentWorkloadFixture } from './developmentWorkloadFixture';

export function cleanupEvidenceFixture(s: DevelopmentCleanupSelection) {
  const key = { executionId: s.identity.executionId, journalId: crypto.randomUUID(), incarnation: crypto.randomUUID(), payloadDigest: 'a'.repeat(64) };
  const registration = { key, runtimeTaskId: s.identity.executionId, podUid: s.podUid, identity: s.identity, profileId: s.profileId, profileRevision: s.profileRevision };
  return DevelopmentCleanupEvidenceSchema.parse({ version: 1, selection: s, registration,
    stop: { version: 1, state: 'finished', receipt: { key, podUid: s.podUid, identity: s.identity, profileId: s.profileId, profileRevision: s.profileRevision,
      phase: 'finished', result: 'cancelled', lastSequence: 0, acknowledgedSequence: 0, finalThrough: 0, interruption: null } },
    closure: { status: 'complete', persistedThrough: 0, reportedThrough: 0, missingAfter: null, missingThrough: null, tailUnknown: false, reason: null, closedAt: '2026-10-01T00:00:00.000Z' },
    owner: { payloadDigest: key.payloadDigest, firstReason: 'cancelled', acceptedAt: '2026-09-30T00:00:00.000Z', profileId: s.profileId, profileRevision: s.profileRevision, protocol: 'opencode', priceBookRevision: 3 } });
}
function eventWaiter() {
  const listeners = new Map<string, Array<() => void>>(), timers = new Set<ReturnType<typeof setTimeout>>();
  return { emit: (key: string) => { for (const done of listeners.get(key) ?? []) done(); listeners.delete(key); },
    wait: (key: string) => new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { timers.delete(timer); reject(new Error('missing cleanup checkpoint: ' + key)); }, 8000); timers.add(timer);
      const done = () => { clearTimeout(timer); timers.delete(timer); resolve(); }; listeners.set(key, [...listeners.get(key) ?? [], done]);
    }), close: () => { for (const timer of timers) clearTimeout(timer); } };
}
async function markContainers(f: Awaited<ReturnType<typeof developmentWorkloadFixture>>, env: TaskEnvironment, stopped: boolean) {
  const pod = (await f.k8s.get(Resources.Pod!, env.podName, env.namespace))!;
  const spec = pod.spec as { containers: Array<{ name: string }>; initContainers: Array<{ name: string }> };
  const at = new Date().toISOString();
  await f.k8s.mergePatch(Resources.Pod!, env.podName, env.namespace, { status: { phase: stopped ? 'Succeeded' : 'Running',
    containerStatuses: spec.containers.map((c) => ({ name: c.name, containerID: 'containerd://original-main', state: stopped ? { terminated: { exitCode: 0, finishedAt: at } } : { running: { startedAt: at } } })),
    initContainerStatuses: spec.initContainers.map((c) => ({ name: c.name, containerID: 'containerd://original-init', state: { terminated: { exitCode: 0, finishedAt: at } } })),
  } });
  await f.k8s.mergePatch(Resources.Lease!, 'worker-one', 'kube-node-lease', { spec: { renewTime: at } });
}
function stoppableApi(f: Awaited<ReturnType<typeof developmentWorkloadFixture>>, env: TaskEnvironment, event: ReturnType<typeof eventWaiter>) {
  const rawDelete = f.k8s.delete.bind(f.k8s), rawPatch = f.k8s.jsonPatch.bind(f.k8s);
  const state = { autoStop: true, holdPod: false, losePodAck: false, loseRunnerAck: false, loseAdmissionAck: false,
    beforeSecretDelete: undefined as (() => Promise<void>) | undefined, deleteRequests: [] as string[] };
  f.k8s.delete = async (...args) => {
    const [ref, name, namespace, options] = args;
    const pod = ref.kind === 'Pod' && name === env.podName ? await f.k8s.get(ref, name, namespace) : undefined;
    if (pod) {
      if (options?.preconditions?.uid !== pod.metadata.uid) throw conflict('original UID precondition required');
      state.deleteRequests.push('Pod:' + name);
      await f.k8s.mergePatch(ref, name, namespace, { metadata: { deletionTimestamp: pod.metadata.deletionTimestamp ?? new Date().toISOString() } });
      if (state.autoStop) await markContainers(f, env, true);
      if (!pod.metadata.finalizers?.length && !state.holdPod) await rawDelete(...args);
      event.emit('pod-delete');
      if (state.losePodAck) { state.losePodAck = false; throw new Error('original Pod delete ACK lost'); }
      return true;
    }
    if (ref.kind === 'Secret' && [env.podName + '-runner', env.podName + '-admission'].includes(name)) {
      state.deleteRequests.push('Secret:' + name); await state.beforeSecretDelete?.();
      const result = await rawDelete(...args), admission = name.endsWith('-admission');
      if (admission ? state.loseAdmissionAck : state.loseRunnerAck) {
        if (admission) state.loseAdmissionAck = false; else state.loseRunnerAck = false;
        throw new Error('original Secret delete ACK lost');
      }
      return result;
    }
    return rawDelete(...args);
  };
  f.k8s.jsonPatch = async <T extends K8sObject>(...args: Parameters<typeof rawPatch>) => {
    const result = await rawPatch<T>(...args);
    if (args[0].kind === 'Pod' && args[1] === env.podName && !result.metadata.finalizers?.includes(WORKLOAD_STOP_FINALIZER)) {
      event.emit('finalizer-removed');
      if (result.metadata.deletionTimestamp && !state.holdPod) await rawDelete(Resources.Pod!, env.podName, env.namespace, { preconditions: { uid: env.native!.podUid } });
    }
    return result;
  };
  return { state, terminate: () => markContainers(f, env, true), finishDeletion: async () => {
    const pod = await f.k8s.get(Resources.Pod!, env.podName, env.namespace);
    if (pod?.metadata.finalizers?.length) throw new Error('Controller has not released its original finalizer');
    await rawDelete(Resources.Pod!, env.podName, env.namespace, { preconditions: { uid: env.native!.podUid } });
  } };
}
export async function developmentCleanupFixture(mode: 'ledger' | 'native' = 'ledger', release = true, receiptProtection = false, historicalUnmarked = false) {
  const f = await developmentWorkloadFixture(mode, true, historicalUnmarked), input = { ...f.request(), ...(receiptProtection ? { developmentRemovalProtection: { version: 1 as const } } : {}) };
  await f.runtime.api.createNativeExecution(input);
  if (mode === 'native') await f.runNative();
  const activated = f.receipt('activation'), admission = f.controller(); admission.observer.start(); await activated; await admission.reconciled(); await admission.observer.stop();
  const env = await f.load(input.id); await markContainers(f, env, false);
  const secret = (await f.k8s.get(Resources.Secret!, env.podName + '-runner', env.namespace))!;
  await f.runtime.api.onRunnerConnected(env.id, (secret['stringData'] as Record<string, string>)['CS_RUNNER_TOKEN']!);
  const event = eventWaiter(), physical = stoppableApi(f, env, event);
  const observe = f.resources.api.observe;
  f.resources.api.observe = async (input) => {
    const result = await observe(input);
    if ('record' in result && result.record?.id === env.id && (await f.resources.api.get(env.id))?.phase === 'stopped') event.emit('resource-stopped');
    return result;
  };
  const settle = async () => {
    if ((await f.resources.api.get(env.id))?.phase === 'stopped') return;
    const stopped = event.wait('resource-stopped'), controller = f.controller(); controller.observer.start(); await stopped; await controller.observer.stop();
  };
  const control = { permitted: true, calls: 0, evidence: undefined as ReturnType<typeof cleanupEvidenceFixture> | undefined,
    onAdvance: undefined as (() => Promise<void>) | undefined };
  const participant = { advance: async (selection: DevelopmentCleanupSelection) => {
    control.calls++; await control.onAdvance?.();
    if (!control.permitted) return { kind: 'waiting' as const, reason: 'digital-copy' };
    control.evidence ??= cleanupEvidenceFixture(selection); return { kind: 'permitted' as const, evidence: control.evidence };
  } };
  f.replace({ developmentCleanup: participant });
  if (release) await f.runtime.api.releaseEnvironment(env.id, 'user');
  const close = f.close;
  return { ...f, get runtime() { return f.runtime; }, env, input, participant, control, physical, settle, wait: event.wait,
    close: async () => { event.close(); await close(); } };
}
export type DevelopmentCleanupFixture = Awaited<ReturnType<typeof developmentCleanupFixture>>;
