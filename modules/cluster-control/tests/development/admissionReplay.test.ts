// RFC-034 v1 P2: exercise real Resources PostgreSQL CAS and the public Controller queue after an original actual create response.
import { afterEach, describe, expect, test } from 'bun:test';
import { ProjectIdSchema, WorkloadConsumerSchema } from '@crewstation/contracts';
import { createFakeK8sClient, LABELS, Resources, type K8sObject } from '@crewstation/k8s';
import { newResourceId, noopLogger } from '@crewstation/kernel';
import { createResourcesModule, resourcesMigrations } from '@crewstation/module-resources';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { createClusterControlModule } from '../../wiring';
import { kubernetesClusterWriter } from '../../adapters/k8s/managedObjects';
import { workloadRenderOf } from '../../domain/workloadRender';

function event() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
async function actual<T>(promise: Promise<T>, diagnostics: () => unknown[] = () => []): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('original receipt checkpoint missing: ' + JSON.stringify(diagnostics()))), 10_000); })]); }
  finally { if (timer) clearTimeout(timer); }
}
async function fixture() {
  const database = await createTestDatabase([resourcesMigrations]), k8s = createFakeK8sClient(), logs: unknown[] = [];
  const resources = createResourcesModule({ db: database.db, quotas: { limitFor: async () => 1000 }, authorizer: { projectAccess: async () => ({ operate: true }) }, isAdmin: async () => true });
  const owner = resources.api.owner('task-runtime'), parentId = newResourceId(), childId = newResourceId(), projectId = ProjectIdSchema.parse(newResourceId());
  const parentUid = crypto.randomUUID(), volumeUid = crypto.randomUUID(), nodeUid = crypto.randomUUID(), namespace = 'cs-receipt-replay', name = 'original-agent';
  const consumer = WorkloadConsumerSchema.parse({ id: newResourceId(), taskId: parentId, resourceId: childId, namespace, podName: name, revision: 1, purpose: 'agent', finalization: null, volumeUid });
  const { resourceId: _resource, namespace: _namespace, podName: _name, volumeUid: _volume, ...intent } = consumer;
  const parent = await owner.declare({ id: parentId, kind: 'dev-workspace', ref: parentId, projectId, purpose: 'development-workspace', spec: { children: [{ kind: 'Pod', namespace, name: 'original-parent' }] } });
  const volume = await owner.declare({ kind: 'volume', ref: parentId + '/work', projectId, parentId, spec: { children: [{ kind: 'PersistentVolumeClaim', namespace, name: 'original-work' }] } });
  const pod = { image: 'task@sha256:original', workerUid: 10001, resources: { cpu: '1', memory: '2Gi', storage: '10Gi' }, workload: 'dev-session', project: 'demo', service: 'demo',
    pvc: 'original-work', secret: name + '-runner', developmentUsageStorage: { version: 1 }, developmentUsageProtection: { version: 1 }, developmentRemovalProtection: { version: 1 },
    expectedVolumeUid: volumeUid, consumer: intent, nodeName: 'original-node', workspace: { pod: 'original-parent', podUid: parentUid, pvcUid: volumeUid },
    labels: { 'crewstation.io/workspace-task': parentId }, annotations: { 'crewstation.io/cli-intent': 'a'.repeat(64) } };
  const declaration = { id: childId, kind: 'agent-execution' as const, ref: childId, projectId, parentId, purpose: 'development-agent' as const, conditions: [{ type: 'Provisioning', status: 'true' as const }],
    spec: { children: [{ kind: 'Pod', namespace, name }, { kind: 'Secret', namespace, name: pod.secret }, { kind: 'Secret', namespace, name: name + '-admission' }], workloadConsumerId: consumer.id, pod } };
  await owner.declare(declaration);
  expect(workloadRenderOf(childId, (await resources.api.get(childId))!.spec)).toBeDefined();
  expect((await resources.api.list({})).some((record) => record.id === childId)).toBe(true);
  await resources.api.observe({ resourceId: parent.id, child: { kind: 'Pod', namespace, name: 'original-parent', uid: parentUid, phase: 'Running', ready: true, node: 'original-node' } });
  await resources.api.observe({ resourceId: volume.id, child: { kind: 'PersistentVolumeClaim', namespace, name: pod.pvc, uid: volumeUid, phase: 'Bound', ready: true } });
  await k8s.create({ apiVersion: 'v1', kind: 'Pod', metadata: { name: 'original-parent', namespace, uid: parentUid, labels: { [LABELS.task]: parentId } }, spec: { nodeName: 'original-node', volumes: [{ name: 'work', persistentVolumeClaim: { claimName: pod.pvc } }] }, status: { phase: 'Running' } });
  await k8s.create({ apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata: { name: pod.pvc, namespace, uid: volumeUid, labels: { [LABELS.task]: parentId } }, status: { phase: 'Bound' } });
  await k8s.create({ apiVersion: 'v1', kind: 'Node', metadata: { name: 'original-node', uid: nodeUid }, status: { conditions: [{ type: 'Ready', status: 'True' }], nodeInfo: { kubeletVersion: 'v1.35.0' } } });
  await k8s.create({ apiVersion: 'coordination.k8s.io/v1', kind: 'Lease', metadata: { name: 'original-node', namespace: 'kube-node-lease', ownerReferences: [{ apiVersion: 'v1', kind: 'Node', name: 'original-node', uid: nodeUid }] }, spec: { holderIdentity: 'original-node', renewTime: new Date().toISOString() } });
  const failed = event(), acknowledged = event(), state = { beforeSave: false, afterSave: false, beforeAck: false, invisible: false, creates: 0, bindCalls: 0, grants: 0 };
  const rawCreate = k8s.create.bind(k8s); k8s.create = async (...args) => { const object: K8sObject = args[0]; if (object.kind === 'Secret' && object.metadata.name.endsWith('-admission')) state.creates++; object.metadata.uid ??= crypto.randomUUID(); if (object.kind === 'Pod' && object.metadata.name === name) { object['spec'] = { ...(object['spec'] as object), nodeName: 'original-node' }; object['status'] = { phase: 'Pending' }; } return rawCreate(...args); };
  const rawSafety = resources.api.workloadSafety, safety = { ...rawSafety,
    grantStart: async (...args: Parameters<typeof rawSafety.grantStart>) => { state.grants++; return rawSafety.grantStart(...args); },
    bindDevelopmentAdmission: async (...args: Parameters<NonNullable<typeof rawSafety.bindDevelopmentAdmission>>) => {
      state.bindCalls++; if (state.beforeSave) { failed.resolve(); throw new Error('original PG save failed'); }
      const result = await rawSafety.bindDevelopmentAdmission!(...args); if (state.afterSave) { failed.resolve(); throw new Error('original PG confirmation lost'); } return result;
    } };
  const writer = kubernetesClusterWriter(k8s), rawAck = writer.acknowledgeDevelopmentAdmissionReceipt!.bind(writer);
  writer.acknowledgeDevelopmentAdmissionReceipt = (receipt) => { if (state.beforeAck) { failed.resolve(); throw new Error('original ACK lost'); } rawAck(receipt); acknowledged.resolve(); };
  const objects = () => [...k8s.objects.values()];
  const control = createClusterControlModule({ k8s, cluster: writer, logger: { ...noopLogger, info: (message, fields) => { logs.push({ message, fields }); if (logs.length > 16) logs.shift(); }, debug: (message, fields) => { logs.push({ message, fields }); if (logs.length > 16) logs.shift(); }, warn: (message, fields) => { logs.push({ message, fields }); if (logs.length > 16) logs.shift(); } }, systemNamespace: 'cs-system', isAdmin: async () => true, orphanSweep: false, reconciler: { pollMs: 10, retryMs: 10, concurrency: 1 },
    ledger: { ...resources.api, workloadSafety: safety, get: (id) => state.invisible && id === childId ? Promise.resolve(undefined) : resources.api.get(id),
      listLive: () => state.invisible ? Promise.resolve([]) : resources.api.list({}), children: (id) => resources.api.list({ parentId: id, includeStopped: true }), adoptOrphanVolume: async () => {} },
    legacy: { resolveTaskId: async () => undefined, task: async () => undefined },
    feed: { start: () => {}, stop: async () => {}, synced: async () => {}, cached: (kind, ns, n) => objects().find((o) => o.kind === kind && o.metadata.namespace === ns && o.metadata.name === n), list: (kind) => objects().filter((o) => o.kind === kind) },
    workloads: { runnerValues: async () => ({ CS_RUNNER_TOKEN: 'fixture' }), checkoutValues: async () => ({ token: 'fixture' }),
      bindWorkload: async (_id, podUid) => { await owner.declare({ ...declaration, spec: { ...declaration.spec, pod: { ...pod, expectedPodUid: podUid } } }); }, workloadUnavailable: async () => {} } });
  return { database, resources, k8s, safety, consumer, writer, control, state, failed, acknowledged, logs, childId, pod,
    close: async () => { await control.observer.stop(); await database.drop(); } };
}
const available = await testDatabaseAvailable();
describe.skipIf(!available)('original creator replay through public Controller and real Resources PG', () => {
  let f: Awaited<ReturnType<typeof fixture>>;
  afterEach(async () => { await f?.close(); });
  for (const fault of ['beforeSave', 'afterSave', 'beforeAck'] as const) {
    test(fault + ': closure and ledger absence do not skip a known UID; replay never creates, inspects or grants again', async () => {
      f = await fixture(); f.state[fault] = true; f.control.observer.start(); await actual(f.failed.promise, () => [...f.logs, f.state, [...f.k8s.objects.values()].map((object) => ({ kind: object.kind, name: object.metadata.name, nodeName: (object.spec as { nodeName?: string } | undefined)?.nodeName }))]);
      const receipt = f.writer.pendingDevelopmentAdmissionReceipts!()[0]!; expect(receipt.secretUid).toBeDefined();
      f.state.invisible = true; await f.safety.closeConsumer(f.consumer.id); f.state[fault] = false;
      await actual(f.acknowledged.promise); await f.control.reconciled();
      const saved = (await f.safety.get(f.consumer.id))!; expect(saved.admissionClosed).toBe(true); expect(saved.developmentAdmission?.secretUid).toBe(receipt.secretUid);
      expect(f.state.creates).toBe(1); expect(f.state.grants).toBe(1); expect(f.state.bindCalls).toBeGreaterThanOrEqual(2); expect(f.writer.pendingDevelopmentAdmissionReceipts!()).toEqual([]);
      expect((await f.k8s.get(Resources.Secret!, f.pod.secret, f.consumer.namespace))?.metadata.uid).toBeDefined();
    }, 15_000);
  }
  test('same writer stop/start resync requeues its finite pending original ID even when listLive and ledger get omit it', async () => {
    f = await fixture(); f.state.beforeSave = true; f.control.observer.start(); await actual(f.failed.promise, () => [...f.logs, f.state, [...f.k8s.objects.values()].map((object) => ({ kind: object.kind, name: object.metadata.name, nodeName: (object.spec as { nodeName?: string } | undefined)?.nodeName }))]); await f.control.observer.stop();
    const original = f.writer.pendingDevelopmentAdmissionReceipts!()[0]!; await f.safety.closeConsumer(f.consumer.id); f.state.invisible = true; f.state.beforeSave = false;
    f.control.observer.start(); await actual(f.acknowledged.promise); await f.control.reconciled();
    expect((await f.safety.get(f.consumer.id))?.developmentAdmission?.secretUid).toBe(original.secretUid); expect(f.state.creates).toBe(1); expect(f.state.grants).toBe(1);
    expect(f.writer.pendingDevelopmentAdmissionReceipts!()).toEqual([]);
  }, 15_000);
  test('a new writer without the actual response cannot replace the historical receipt with a same-name same-material object', async () => {
    f = await fixture(); f.state.beforeSave = true; f.control.observer.start(); await actual(f.failed.promise, () => [...f.logs, f.state, [...f.k8s.objects.values()].map((object) => ({ kind: object.kind, name: object.metadata.name, nodeName: (object.spec as { nodeName?: string } | undefined)?.nodeName }))]); await f.control.observer.stop();
    const original = f.writer.pendingDevelopmentAdmissionReceipts!()[0]!, render = workloadRenderOf(f.childId, (await f.resources.api.get(f.childId))!.spec)!.pod;
    const replacement = crypto.randomUUID(); await f.k8s.mergePatch(Resources.Secret!, render.name + '-admission', render.namespace, { metadata: { uid: replacement } });
    const restarted = kubernetesClusterWriter(f.k8s), state = (await f.safety.get(f.consumer.id))!;
    await expect(restarted.activateWorkload!({ ...render, consumerVolumeUid: f.consumer.volumeUid }, original.permit, state.developmentAdmission)).rejects.toThrow('同名对象');
    expect((await f.safety.get(f.consumer.id))?.developmentAdmission?.secretUid).toBeNull(); expect(f.state.creates).toBe(1); expect(restarted.pendingDevelopmentAdmissionReceipts!()).toEqual([]);
    expect((await f.k8s.get(Resources.Secret!, render.name + '-admission', render.namespace))?.metadata.uid).toBe(replacement);
  }, 15_000);
});
