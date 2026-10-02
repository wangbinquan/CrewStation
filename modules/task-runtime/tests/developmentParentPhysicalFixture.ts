// Fake Kubernetes preserves finalizers and UID/RV preconditions; real Controller records the all-container proof in PG.
// The digital child participant is explicitly a controlled regression fixture, not a real model collector.
import { WORKLOAD_STOP_FINALIZER } from '@crewstation/contracts';
import { conflict } from '@crewstation/kernel';
import { Resources } from '@crewstation/k8s';
import type { K8sObject } from '@crewstation/k8s';
import type { Worker } from '@crewstation/queue';
import { sql } from 'drizzle-orm';
import { developmentCleanupFixture } from './developmentCleanupFixture';
import type { DevelopmentCleanupFixture } from './developmentCleanupFixture';
import { endingCheckpoint } from './developmentParentEndingLeaseFixture';
import { readDevelopmentParentEnding } from '../domain/development/parentEnding';

async function markParentContainers(f: DevelopmentCleanupFixture, stopped: boolean) {
  const pod = (await f.k8s.get(Resources.Pod!, f.parent.podName, f.parent.namespace))!;
  const spec = pod.spec as { containers: Array<{ name: string }>; initContainers?: Array<{ name: string }>; ephemeralContainers?: Array<{ name: string }> };
  const at = new Date().toISOString(), statuses = (rows: Array<{ name: string }>) => rows.map((c) => ({ name: c.name, containerID: 'containerd://parent-' + c.name,
    state: stopped ? { terminated: { exitCode: 0, finishedAt: at } } : { running: { startedAt: at } } }));
  await f.k8s.mergePatch(Resources.Pod!, f.parent.podName, f.parent.namespace, { status: { phase: stopped ? 'Succeeded' : 'Running',
    containerStatuses: statuses(spec.containers), initContainerStatuses: statuses(spec.initContainers ?? []), ephemeralContainerStatuses: statuses(spec.ephemeralContainers ?? []) } });
  await f.k8s.mergePatch(Resources.Lease!, 'worker-one', 'kube-node-lease', { spec: { renewTime: at } });
}
function parentPhysical(f: DevelopmentCleanupFixture) {
  const rawDelete = f.k8s.delete.bind(f.k8s), rawPatch = f.k8s.jsonPatch.bind(f.k8s), removed = endingCheckpoint();
  const state = { autoStop: true, holdPod: false, loseDeleteAck: false, deletes: 0 };
  f.k8s.delete = async (...args) => {
    const [ref, name, namespace, options] = args;
    if (ref.kind !== 'Pod' || name !== f.parent.podName) return rawDelete(...args);
    const pod = await f.k8s.get(ref, name, namespace); if (!pod) return false;
    if (options?.preconditions?.uid !== pod.metadata.uid || options?.preconditions?.resourceVersion !== pod.metadata.resourceVersion)
      throw conflict('parent original UID and resourceVersion required');
    state.deletes++; await f.k8s.mergePatch(ref, name, namespace, { metadata: { deletionTimestamp: pod.metadata.deletionTimestamp ?? new Date().toISOString() } });
    if (state.autoStop) await markParentContainers(f, true);
    if (!pod.metadata.finalizers?.length && !state.holdPod) await rawDelete(ref, name, namespace, { preconditions: { uid: pod.metadata.uid } });
    if (state.loseDeleteAck) { state.loseDeleteAck = false; throw new Error('parent original delete ACK lost'); }
    return true;
  };
  f.k8s.jsonPatch = async <T extends K8sObject>(...args: Parameters<typeof rawPatch>) => {
    const result = await rawPatch<T>(...args);
    if (args[0].kind === 'Pod' && args[1] === f.parent.podName && result.metadata.deletionTimestamp
      && !result.metadata.finalizers?.includes(WORKLOAD_STOP_FINALIZER)) {
      if (!state.holdPod) await rawDelete(Resources.Pod!, f.parent.podName, f.parent.namespace, { preconditions: { uid: f.parentPod.metadata.uid } });
      removed.resolve();
    }
    return result;
  };
  const waitRemoved = async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([removed.promise, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('original parent Controller finalizer ACK missing')), 8000); })]); }
    finally { if (timer) clearTimeout(timer); }
  };
  return { state, waitRemoved, terminate: () => markParentContainers(f, true), finishDeletion: async () => {
    const pod = await f.k8s.get(Resources.Pod!, f.parent.podName, f.parent.namespace);
    if (pod?.metadata.finalizers?.includes(WORKLOAD_STOP_FINALIZER)) throw new Error('original parent finalizer remains');
    return rawDelete(Resources.Pod!, f.parent.podName, f.parent.namespace, { preconditions: { uid: f.parentPod.metadata.uid } });
  } };
}
export async function developmentParentPhysicalFixture(mode: 'ledger' | 'native' = 'ledger') {
  const f = await developmentCleanupFixture(mode, true, true);
  const childRemoved = f.wait('finalizer-removed'), childController = f.controller(); childController.observer.start();
  await f.runNative(); await childRemoved; await childController.reconciled(); await childController.observer.stop(); await f.runNative(); await f.settle();
  if ((await f.load(f.env.id)).native?.state !== 'finished') throw new Error('actual child did not finish');
  await f.k8s.mergePatch(Resources.PersistentVolumeClaim!, f.parent.pvcName, f.parent.namespace, { status: { phase: 'Bound', capacity: { storage: '10Gi' } } });
  await markParentContainers(f, false); const physical = parentPhysical(f);
  const ending = async () => { const parent = await f.load(f.parent.id); return (await f.uow.read.parentEnding!.endings.get(readDevelopmentParentEnding(parent)!.endingId))!; };
  const runEnding = () => (f.runtime.workers[4] as Worker).runOnce();
  const retry = async () => { await f.tdb.db.execute(sql`UPDATE task_runtime.development_parent_endings SET retry_at=clock_timestamp()-interval '1 second' WHERE phase<>'complete'`);
    await (f.runtime.workers[5] as Worker).runOnce(); return runEnding(); };
  const settleParent = async () => {
    if ((await f.resources.api.get(f.parent.id))?.phase === 'stopped') return;
    const done = endingCheckpoint(), observe = f.resources.api.observe;
    f.resources.api.observe = async (input) => { const result = await observe(input);
      if ('record' in result && result.record?.id === f.parent.id && (await f.resources.api.get(f.parent.id))?.phase === 'stopped') done.resolve();
      return result;
    };
    const controller = f.controller(); let timer: ReturnType<typeof setTimeout> | undefined;
    try { controller.observer.start(); await Promise.race([done.promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('actual parent resource stop observation missing')), 8000);
    })]); await controller.reconciled(); }
    finally { if (timer) clearTimeout(timer); await controller.observer.stop(); f.resources.api.observe = observe; }
  };
  const rebuiltPhysical = async () => {
    const parent = await f.load(f.parent.id), parentPod = (await f.k8s.get(Resources.Pod!, parent.podName, parent.namespace))!;
    if (!parentPod || parentPod.metadata.uid !== parent.podUid) throw new Error('actual new parent Pod binding missing');
    const rebuild = parent.rebuildId ? await f.uow.read.rebuilds.get(parent.rebuildId) : undefined;
    if (!rebuild?.nodeName) throw new Error('original retained-volume node binding missing');
    // The controlled Kubernetes scheduler assigns the actual new Pod to its original retained-volume node.
    await f.k8s.mergePatch(Resources.Pod!, parent.podName, parent.namespace, { spec: { nodeName: rebuild.nodeName } });
    const selected = { ...f, parent, parentPod }; await markParentContainers(selected, false); return parentPhysical(selected);
  };
  return { ...f, get runtime() { return f.runtime; }, parentPhysical: physical, rebuiltPhysical, ending, runEnding, retry, settleParent };
}
export type DevelopmentParentPhysicalFixture = Awaited<ReturnType<typeof developmentParentPhysicalFixture>>;
