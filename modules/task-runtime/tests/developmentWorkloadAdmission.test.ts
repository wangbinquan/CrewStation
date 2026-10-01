// RFC-034: actual public owners and PostgreSQL, with a controlled API-server substitute; no model call or fabricated grant.
import { afterEach, describe, expect, test } from 'bun:test';
import { Resources } from '@crewstation/k8s';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { TaskIdSchema } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';
import { developmentRequestHash } from '../application/development/workloadAdmission';
import { claimJobs } from '@crewstation/queue';
import { sql } from 'drizzle-orm';
import { NATIVE_EXECUTION_JOB_KIND } from '../ports/repositories';
import type { DevelopmentWorkloadFixture } from './developmentWorkloadFixture';
import { developmentWorkloadFixture } from './developmentWorkloadFixture';

function checkpoint() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
async function within<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(label)), 4_000); })]); }
  finally { clearTimeout(timer); }
}
async function projectLockWait(f: DevelopmentWorkloadFixture): Promise<void> {
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    const rows = await f.tdb.db.execute(sql`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%task_runtime%admissions%'`) as unknown as Array<{ n: number }>;
    if (rows[0]!.n > 0) return;
    await Bun.sleep(5);
  }
  throw new Error('no actual PostgreSQL project-lock contender');
}

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-034 actual development workload admission', () => {
  let f: DevelopmentWorkloadFixture;
  afterEach(async () => { await f?.close(); });
  test('missing new selector keeps the exact legacy request hash; submitting it freezes a distinct first choice', async () => {
    f = await developmentWorkloadFixture('native'); const input = f.request();
    const legacy = jsonHash({ id: input.id, parentTaskId: input.parentTaskId, purpose: input.purpose ?? 'cli', createdBy: input.createdBy ?? null,
      agentId: input.agentId, terminalId: input.terminalId ?? null, runnerId: input.runnerId, fingerprint: input.fingerprint, profile: input.profile ?? null,
      image: input.image ?? null, computeProfile: input.computeProfile ?? null, runtimeImage: input.runtimeImage ?? null, businessSession: input.businessSession ?? null,
      developmentUsageStorage: input.developmentUsageStorage ?? null, developmentUsageProtection: input.developmentUsageProtection ?? null });
    expect(developmentRequestHash(input)).toBe(legacy); expect(developmentRequestHash({ ...input, developmentRemovalProtection: { version: 1 } })).not.toBe(legacy);
    const admitted = await f.runtime.api.createNativeExecution(input); expect((await f.load(admitted.id)).render).not.toHaveProperty('developmentRemovalProtection');
    await expect(f.runtime.api.createNativeExecution({ ...input, developmentRemovalProtection: { version: 1 } })).rejects.toMatchObject({ kind: 'conflict' });
  });
  for (const mode of ['ledger', 'native'] as const) {
    test(mode + ': first receipt selection reaches the original Resources registration and actual Controller Secret UID', async () => {
      f = await developmentWorkloadFixture(mode); const input = { ...f.request(), developmentRemovalProtection: { version: 1 as const } };
      const admitted = await f.runtime.api.createNativeExecution(input), original = await f.load(admitted.id);
      expect(original.render?.developmentRemovalProtection).toEqual({ version: 1 });
      expect((await f.resources.api.get(original.id))?.spec['pod']).toMatchObject({ developmentRemovalProtection: { version: 1 } });
      if (mode === 'native') await f.runNative();
      const activated = f.receipt('activation'), control = f.controller(); control.observer.start(); await activated; await control.reconciled();
      const actual = (await f.k8s.get(Resources.Secret!, original.podName + '-admission', original.namespace))!;
      expect((await f.safety.get(original.render!.workloadConsumerId!))?.developmentAdmission?.secretUid).toBe(actual.metadata.uid);
      await expect(f.runtime.api.createNativeExecution({ ...input, developmentRemovalProtection: undefined })).rejects.toMatchObject({ kind: 'conflict' });
    }, 15_000);
  }
  test('unsupported or incomplete receipt choice rejects before admission and native preparation waits if the original selected state is missing', async () => {
    f = await developmentWorkloadFixture('native'); const input = { ...f.request(), developmentRemovalProtection: { version: 1 as const } };
    for (const patch of [{ developmentUsageProtection: undefined }, { developmentUsageStorage: undefined }, { purpose: 'cli' as const }, { terminalId: crypto.randomUUID() },
      { developmentRemovalProtection: { version: 2 } as unknown as { version: 1 } }, { developmentRemovalProtection: { version: 1 as const, extra: true } }]) {
      await expect(f.runtime.api.createNativeExecution({ ...input, ...patch })).rejects.toThrow(); expect(await f.resources.api.occupancy(f.parent.projectId)).toBe(1);
    }
    const registered = f.safety.register;
    f.safety.register = async (consumer) => ({ ...await registered(consumer), developmentAdmission: undefined });
    const admitted = await f.runtime.api.createNativeExecution(input); await f.runNative();
    expect((await f.load(admitted.id)).native?.state).toBe('queued'); expect(f.calls.some((call) => call === 'materials' || call.startsWith('create:'))).toBe(false);
    expect(await f.resources.api.occupancy(f.parent.projectId)).toBe(2);
  });
  for (const mode of ['ledger', 'native'] as const) {
    test(mode + ': original admission projects protection and only the public controller activates the bound UID', async () => {
      f = await developmentWorkloadFixture(mode);
      const input = f.request(), result = await f.runtime.api.createNativeExecution(input), env = await f.load(result.id);
      expect(env.render).toMatchObject({ developmentUsageProtection: { version: 1 }, developmentUsageStorage: { version: 1 }, execution: { workspacePod: f.parent.podName } });
      const record = (await f.resources.api.get(env.id))!;
      expect(record.spec['pod']).toMatchObject({ developmentUsageProtection: { version: 1 }, consumer: { id: env.render!.workloadConsumerId, taskId: f.parent.id, revision: 1, purpose: 'agent' }, expectedVolumeUid: f.pvc.metadata.uid });
      expect(record.conditions.find((c) => c.type === 'Provisioning')?.status).toBe(mode === 'ledger' ? 'true' : 'false');
      expect(record.spec.children).toHaveLength(3);
      if (mode === 'native') { expect(await f.runNative()).toBe(1); expect((await f.load(env.id)).native?.state).toBe('starting'); }
      const activated = f.receipt('activation'), control = f.controller(); control.observer.start(); await activated; await control.reconciled();
      const bound = await f.load(env.id), pod = (await f.k8s.get(Resources.Pod!, env.podName, env.namespace))!;
      const state = (await f.safety.get(env.render!.workloadConsumerId!))!;
      expect(bound.native?.podUid).toBe(pod.metadata.uid);
      expect(state.startPermit?.podUid).toBe(pod.metadata.uid);
      expect((await f.resources.api.get(env.id))?.spec['pod']).toMatchObject({ expectedPodUid: pod.metadata.uid });
      expect(f.calls.indexOf('register')).toBeLessThan(f.calls.indexOf('create:' + env.podName + '-runner'));
      expect((await f.k8s.get(Resources.Secret!, env.podName + '-admission', env.namespace))?.['stringData']).toMatchObject({ podUid: pod.metadata.uid, consumerId: state.consumer.id });
      expect(await f.resources.api.occupancy(env.projectId)).toBe(2);
      expect((await f.safety.list(f.parent.id)).items).toHaveLength(1);
    }, 15_000);
  }
  test('same input retains the original selection across configuration changes; dropping protection or changing compute/image conflicts', async () => {
    f = await developmentWorkloadFixture('native');
    const input = f.request(), first = await f.runtime.api.createNativeExecution(input), original = await f.load(first.id);
    f.profiles[0]!.cpu = '4'; f.replace({ settings: { ...f.deps.settings, taskImage: 'replacement-image' } });
    expect((await f.runtime.api.createNativeExecution(input)).id).toBe(first.id);
    expect(await f.load(first.id)).toEqual(original);
    for (const patch of [{ developmentUsageProtection: undefined }, { image: 'replacement-image' }, { computeProfile: { ...input.computeProfile!, revision: 4 } }]) {
      await expect(f.runtime.api.createNativeExecution({ ...input, ...patch })).rejects.toMatchObject({ kind: 'conflict' });
    }
    expect(await f.resources.api.occupancy(original.projectId)).toBe(2);
    expect(f.calls.some((c) => c.startsWith('create:'))).toBe(false);
  });
  test('missing real ledger or registration capability and unsupported protection fail before cluster reads, materials and quota', async () => {
    f = await developmentWorkloadFixture('native');
    for (const patch of [{ workloadSafety: undefined }, { ledger: undefined }]) {
      f.replace(patch); f.calls.length = 0;
      await expect(f.runtime.api.createNativeExecution(f.request())).rejects.toMatchObject({ kind: 'precondition' });
      expect(f.calls).toEqual([]); expect(await f.resources.api.occupancy(f.parent.projectId)).toBe(1);
    }
    f.replace();
    for (const patch of [{ purpose: 'cli' as const }, { terminalId: crypto.randomUUID() }, { developmentUsageStorage: undefined }, { computeProfile: undefined },
      { developmentUsageProtection: { version: 1 as const, extra: true } }]) {
      f.calls.length = 0;
      await expect(f.runtime.api.createNativeExecution({ ...f.request(), ...patch })).rejects.toMatchObject({ kind: 'precondition' });
      expect(f.calls).toEqual([]); expect(await f.resources.api.occupancy(f.parent.projectId)).toBe(1);
    }
  });
  test('initial observation wait ACKs only this preparation job; persistent reconciliation restores the same original consumer', async () => {
    f = await developmentWorkloadFixture('native', false);
    const result = await f.runtime.api.createNativeExecution(f.request()), env = await f.load(result.id);
    await f.runNative();
    expect((await f.load(env.id)).native?.state).toBe('queued');
    expect(await f.safety.get(env.render!.workloadConsumerId!)).toBeUndefined();
    expect(f.calls.some((c) => c.startsWith('create:') || c === 'materials')).toBe(false);
    await f.prime(); await f.runtime.api.reconcile(); await f.runNative();
    expect((await f.load(env.id)).native?.state).toBe('starting');
    expect((await f.safety.get(env.render!.workloadConsumerId!))?.consumer.id).toBe(env.render!.workloadConsumerId);
    expect(await f.resources.api.occupancy(env.projectId)).toBe(2);
  });
  test('a ledger Pod created before binding failure is recovered by a new controller before its first grant', async () => {
    f = await developmentWorkloadFixture();
    const result = await f.runtime.api.createNativeExecution(f.request()), env = await f.load(result.id);
    f.faults.bind = true;
    const failed = f.receipt('binding-failed'), first = f.controller(); first.observer.start(); await failed; await first.observer.stop();
    const pod = (await f.k8s.get(Resources.Pod!, env.podName, env.namespace))!;
    expect((await f.resources.api.get(env.id))?.spec['pod']).not.toHaveProperty('expectedPodUid');
    expect((await f.safety.get(env.render!.workloadConsumerId!))?.startPermit).toBeNull();
    expect(await f.k8s.get(Resources.Secret!, env.podName + '-admission', env.namespace)).toBeUndefined();
    f.faults.bind = false;
    const activated = f.receipt('activation'), second = f.controller(); second.observer.start(); await activated; await second.reconciled();
    expect((await f.load(env.id)).native?.podUid).toBe(pod.metadata.uid);
    expect((await f.safety.get(env.render!.workloadConsumerId!))?.startPermit?.podUid).toBe(pod.metadata.uid);
    expect(f.calls.filter((c) => c === 'create:' + env.podName)).toHaveLength(1);
  }, 15_000);
  test('durable grant and immutable activation survive lost responses with the same Pod, consumer and quota', async () => {
    f = await developmentWorkloadFixture();
    const result = await f.runtime.api.createNativeExecution(f.request()), env = await f.load(result.id);
    f.faults.grant = true;
    const lost = f.receipt('grant-lost'), first = f.controller(); first.observer.start(); await lost; await first.observer.stop();
    const state = (await f.safety.get(env.render!.workloadConsumerId!))!;
    expect(state.startPermit).not.toBeNull();
    expect(await f.k8s.get(Resources.Secret!, env.podName + '-admission', env.namespace)).toBeUndefined();
    f.faults.grant = false; f.faults.activation = true;
    const created = f.receipt('activation'), second = f.controller(); second.observer.start(); await created; await second.observer.stop();
    const secret = (await f.k8s.get(Resources.Secret!, env.podName + '-admission', env.namespace))!;
    f.faults.activation = false;
    const granted = f.receipt('grant'), third = f.controller(); third.observer.start(); await granted; await third.reconciled();
    expect((await f.k8s.get(Resources.Secret!, secret.metadata.name, env.namespace))?.metadata.uid).toBe(secret.metadata.uid);
    expect((await f.safety.get(state.consumer.id))?.startPermit).toEqual(state.startPermit);
    expect((await f.safety.list(f.parent.id)).items).toHaveLength(1);
    expect(await f.resources.api.occupancy(env.projectId)).toBe(2);
  }, 15_000);
  test('new selected cleanup retains live drain credentials, original desired objects and occupancy', async () => {
    f = await developmentWorkloadFixture('native');
    const result = await f.runtime.api.createNativeExecution(f.request());
    await f.runNative(); const env = await f.load(result.id);
    const activated = f.receipt('activation'), initial = f.controller(); initial.observer.start(); await activated; await initial.observer.stop();
    const pod = (await f.k8s.get(Resources.Pod!, env.podName, env.namespace))!, secret = (await f.k8s.get(Resources.Secret!, env.podName + '-runner', env.namespace))!;
    const spec = pod.spec as { containers: Array<{ name: string }>; initContainers: Array<{ name: string }> };
    await f.k8s.mergePatch(Resources.Pod!, env.podName, env.namespace, { status: { phase: 'Running',
      containerStatuses: spec.containers.map((c) => ({ name: c.name, containerID: 'containerd://original-main', state: { running: { startedAt: new Date().toISOString() } } })),
      initContainerStatuses: spec.initContainers.map((c) => ({ name: c.name, containerID: 'containerd://original-init', state: { terminated: { exitCode: 0, finishedAt: new Date().toISOString() } } })),
    } });
    expect(await f.runtime.api.onRunnerConnected(env.id, (secret['stringData'] as Record<string, string>)['CS_RUNNER_TOKEN']!)).toBe(true);
    const prepared = await f.load(result.id); expect(prepared.connected).toBe(true);
    await f.runtime.api.releaseEnvironment(TaskIdSchema.parse(result.id), 'user');
    const releasing = await f.load(result.id);
    expect(releasing).toMatchObject({ state: 'releasing', runnerTokenHash: prepared.runnerTokenHash, connected: prepared.connected, native: { state: 'cleaning' } });
    expect((await f.resources.api.get(result.id))?.desired).toBe('present');
    expect((await f.resources.api.get(result.id))?.conditions).toContainEqual(expect.objectContaining({ type: 'ReleasePending', status: 'true' }));
    await f.runNative();
    const inspected = f.receipt('read:' + env.podName), cleanup = f.controller(); cleanup.observer.start(); await inspected; await cleanup.observer.stop();
    expect(f.k8s.deleted).toHaveLength(0);
    expect((await f.k8s.get(Resources.Pod!, env.podName, env.namespace))?.metadata.uid).toBe(pod.metadata.uid);
    expect((await f.k8s.get(Resources.Secret!, env.podName + '-runner', env.namespace))?.metadata.uid).toBe(secret.metadata.uid);
    expect((await f.k8s.get(Resources.Secret!, env.podName + '-admission', env.namespace))?.metadata.uid).toBeDefined();
    expect((await f.load(result.id)).native?.state).toBe('cleaning');
    expect((await f.load(result.id)).runnerTokenHash).toBe(prepared.runnerTokenHash);
    expect((await f.load(result.id)).connected).toBe(true);
    expect((await f.safety.get(env.render!.workloadConsumerId!))?.admissionClosed).toBe(true);
    expect(await f.resources.api.occupancy(prepared.projectId)).toBe(2);
  });

  test('selected admission performs original workspace I/O without the project lock, with the legacy path as a blocking control', async () => {
    for (const selected of [true, false]) {
      f = await developmentWorkloadFixture('native');
      const entered = checkpoint(), acquired = checkpoint(), input = f.request(), rawGet = f.k8s.get.bind(f.k8s);
      const contender = f.uow.run(async (scope) => { await entered.promise; await scope.admissions.lock(f.projectId); acquired.resolve(); });
      f.k8s.get = async (...args) => {
        if (args[1] === f.parent.podName) { entered.resolve(); await within(acquired.promise, 'workspace I/O held the project transaction'); }
        return rawGet(...args);
      };
      try {
        const creating = f.runtime.api.createNativeExecution({ ...input, developmentUsageProtection: selected ? input.developmentUsageProtection : undefined });
        if (selected) expect((await creating).id).toBe(input.id);
        else { await expect(creating).rejects.toThrow('workspace I/O held the project transaction'); expect(await f.uow.read.environments.getById(input.id)).toBeUndefined(); }
        await within(contender, 'independent admission lock never completed');
        expect(await f.resources.api.occupancy(f.projectId)).toBe(selected ? 2 : 1);
      } finally { entered.resolve(); await contender; await f.close(); }
    }
  }, 15_000);
  test('takeover while preparation waits for the project lock rejects the old job commit and preserves the original physical execution for recovery', async () => {
    f = await developmentWorkloadFixture('native');
    const input = f.request(); await f.runtime.api.createNativeExecution(input);
    const original = await f.load(input.id), ready = checkpoint(), unlock = checkpoint(), made = checkpoint(), rawCreate = f.k8s.create.bind(f.k8s);
    f.k8s.create = async (object) => { const actual = await rawCreate(object); if (object.kind === 'Pod' && object.metadata.name === original.podName) made.resolve(); return actual; };
    const holder = f.uow.run(async (scope) => { await scope.admissions.lock(f.projectId); ready.resolve(); await unlock.promise; });
    let preparing: Promise<number> | undefined;
    try {
      await ready.promise; preparing = f.runNative(); await within(made.promise, 'preparation I/O blocked on project lock'); await projectLockWait(f);
      const pod = (await f.k8s.get(Resources.Pod!, original.podName, original.namespace))!, secret = (await f.k8s.get(Resources.Secret!, original.podName + '-runner', original.namespace))!;
      await f.tdb.db.execute(sql`UPDATE platform_infra.jobs SET lease_until = clock_timestamp() - interval '1 second' WHERE kind = ${NATIVE_EXECUTION_JOB_KIND} AND state = 'running'`);
      const [replacement] = await claimJobs(f.tdb.db, [NATIVE_EXECUTION_JOB_KIND], 'replacement-worker', 120, 1);
      expect(replacement!.fencingToken).toBe(2);
      unlock.resolve(); await holder; expect(await preparing).toBe(1);
      expect(await f.load(input.id)).toEqual(original);
      expect((await f.resources.api.get(input.id))?.spec['pod']).not.toHaveProperty('expectedPodUid');
      expect((await f.safety.get(original.render!.workloadConsumerId!))?.startPermit).toBeNull();
      await f.tdb.db.execute(sql`UPDATE platform_infra.jobs SET lease_until = clock_timestamp() - interval '1 second' WHERE id = ${replacement!.id}`);
      expect(await f.runNative()).toBe(1);
      expect(await f.load(input.id)).toMatchObject({ native: { state: 'starting', podUid: pod.metadata.uid, secretUid: secret.metadata.uid } });
      expect((await f.safety.list(f.parent.id)).items).toHaveLength(1);
      expect(f.calls.filter((c) => c === 'materials')).toHaveLength(1);
      expect(f.calls.filter((c) => c === 'create:' + original.podName)).toHaveLength(1);
      expect(await f.resources.api.occupancy(f.projectId)).toBe(2);
    } finally { unlock.resolve(); await Promise.allSettled([holder, preparing]); }
  }, 15_000);
  test('release during unlocked preparation cannot be overwritten by an old ready result or error cleanup', async () => {
    f = await developmentWorkloadFixture('native');
    const input = f.request(); await f.runtime.api.createNativeExecution(input);
    const original = await f.load(input.id), made = checkpoint(), respond = checkpoint(), rawCreate = f.k8s.create.bind(f.k8s);
    f.k8s.create = async (object) => { const actual = await rawCreate(object); if (object.kind === 'Pod' && object.metadata.name === original.podName) { made.resolve(); await respond.promise; } return actual; };
    const preparing = f.runNative();
    try {
      await within(made.promise, 'no original Pod receipt');
      await f.runtime.api.releaseEnvironment(input.id, 'user'); const released = await f.load(input.id);
      expect(released.native?.state).toBe('cleaning'); expect(released.runnerTokenHash).toBe(original.runnerTokenHash);
      respond.resolve(); await preparing;
      expect(await f.load(input.id)).toEqual(released);
      expect((await f.resources.api.get(input.id))?.desired).toBe('present');
      expect((await f.resources.api.get(input.id))?.conditions).toContainEqual(expect.objectContaining({ type: 'ReleasePending', status: 'true' }));
      expect((await f.safety.get(original.render!.workloadConsumerId!))?.startPermit).toBeNull();
      expect(f.k8s.deleted).toHaveLength(0); expect(await f.resources.api.occupancy(f.projectId)).toBe(2);
    } finally { respond.resolve(); await preparing; }
  }, 15_000);
  test('a full selected ledger projection failure rolls back environment, admitted quota and job together', async () => {
    f = await developmentWorkloadFixture('native'); const input = f.request();
    f.replace({ ledger: { ...f.ledger, within: (tx) => {
      const owner = f.ledger.within(tx as object);
      return { ...owner, declare: async (record) => { if (record.id === input.id) throw new Error('selected projection write failed'); return owner.declare(record); } };
    } } });
    await expect(f.runtime.api.createNativeExecution(input)).rejects.toThrow('selected projection write failed');
    expect(await f.uow.read.environments.getById(input.id)).toBeUndefined();
    expect(await f.resources.api.get(input.id)).toBeUndefined();
    expect(await f.resources.api.occupancy(f.projectId)).toBe(1);
    expect(await f.runNative()).toBe(0); expect((await f.safety.list(f.parent.id)).items).toHaveLength(0);
    expect(f.calls.some((call) => call === 'materials' || call.startsWith('create:'))).toBe(false);
  });
  for (const kind of ['Secret', 'Pod'] as const) {
    test('native ' + kind + ' response loss recovers the committed object without changing consumer, credentials or quota', async () => {
      f = await developmentWorkloadFixture('native'); const input = f.request(); await f.runtime.api.createNativeExecution(input);
      const original = await f.load(input.id), rawCreate = f.k8s.create.bind(f.k8s);
      let loseResponse = true;
      f.k8s.create = async (object) => { const actual = await rawCreate(object); if (loseResponse && object.kind === kind) { loseResponse = false; throw new Error(kind + ' response lost'); } return actual; };
      expect(await f.runNative()).toBe(1);
      expect((await f.load(input.id)).native?.state).toBe('queued');
      const secret = (await f.k8s.get(Resources.Secret!, original.podName + '-runner', original.namespace))!;
      const pod = await f.k8s.get(Resources.Pod!, original.podName, original.namespace);
      expect((await f.safety.get(original.render!.workloadConsumerId!))?.startPermit).toBeNull();
      expect(await f.runNative()).toBe(1);
      const prepared = await f.load(input.id);
      expect(prepared.native).toMatchObject({ state: 'starting', secretUid: secret.metadata.uid, ...(pod ? { podUid: pod.metadata.uid } : {}) });
      expect((await f.k8s.get(Resources.Secret!, original.podName + '-runner', original.namespace))?.metadata.uid).toBe(secret.metadata.uid);
      expect(f.calls.filter((c) => c === 'materials')).toHaveLength(1);
      expect(f.calls.filter((c) => c === 'create:' + original.podName + '-runner')).toHaveLength(1);
      expect((await f.safety.list(f.parent.id)).items).toHaveLength(1); expect(await f.resources.api.occupancy(f.projectId)).toBe(2);
      const activated = f.receipt('activation'), controller = f.controller(); controller.observer.start(); await activated; await controller.reconciled();
      expect((await f.safety.get(original.render!.workloadConsumerId!))?.startPermit?.podUid).toBe(prepared.native!.podUid);
    }, 15_000);
  }

  test('a real parent disconnect during preparation invalidates the frozen parent witness before binding', async () => {
    f = await developmentWorkloadFixture('native'); const input = f.request(); await f.runtime.api.createNativeExecution(input);
    const original = await f.load(input.id), made = checkpoint(), respond = checkpoint(), rawCreate = f.k8s.create.bind(f.k8s);
    f.k8s.create = async (object) => { const actual = await rawCreate(object); if (object.kind === 'Pod' && object.metadata.name === original.podName) { made.resolve(); await respond.promise; } return actual; };
    const preparing = f.runNative();
    try {
      await within(made.promise, 'no original Pod receipt'); await f.runtime.api.onRunnerDisconnected(f.parent.id, f.parentToken);
      expect((await f.load(f.parent.id)).connected).toBe(false);
      respond.resolve(); await preparing;
      const failed = await f.load(input.id);
      expect(failed.native?.state).toBe('cleaning'); expect(failed.native?.podUid).toBeUndefined(); expect(failed.runnerTokenHash).toBe(original.runnerTokenHash);
      expect((await f.resources.api.get(input.id))?.spec['pod']).not.toHaveProperty('expectedPodUid');
      expect((await f.safety.get(original.render!.workloadConsumerId!))?.startPermit).toBeNull();
      expect(f.k8s.deleted).toHaveLength(0); expect(await f.resources.api.occupancy(f.projectId)).toBe(2);
    } finally { respond.resolve(); await preparing; }
  }, 15_000);
  test('the public controller refuses grants after parent, volume, child or node evidence changes', async () => {
    for (const failure of ['parent-uid', 'parent-owner', 'volume-uid', 'child-uid', 'node-missing', 'lease-expired']) {
      f = await developmentWorkloadFixture('native'); const input = f.request(); await f.runtime.api.createNativeExecution(input); await f.runNative();
      const env = await f.load(input.id), original = (await f.k8s.get(Resources.Pod!, env.podName, env.namespace))!;
      try {
        if (failure.startsWith('parent-')) {
          const parent = (await f.k8s.get(Resources.Pod!, f.parent.podName, env.namespace))!;
          await f.k8s.apply({ ...parent, metadata: { ...parent.metadata, ...(failure === 'parent-uid' ? { uid: crypto.randomUUID() } : { labels: { ...parent.metadata.labels, 'crewstation.io/task': input.id } }) } });
        } else if (failure === 'volume-uid') {
          const volume = (await f.k8s.get(Resources.PersistentVolumeClaim!, env.pvcName, env.namespace))!;
          await f.k8s.apply({ ...volume, metadata: { ...volume.metadata, uid: crypto.randomUUID() } });
        } else if (failure === 'child-uid') await f.k8s.apply({ ...original, metadata: { ...original.metadata, uid: crypto.randomUUID() } });
        else if (failure === 'node-missing') await f.k8s.delete(Resources.Node!, 'worker-one');
        else await f.k8s.mergePatch(Resources.Lease!, 'worker-one', 'kube-node-lease', { spec: { renewTime: '2000-01-01T00:00:00Z' } });
        const inspected = f.receipt('read:' + env.podName), control = f.controller(); control.observer.start(); await inspected; await control.observer.stop();
        expect((await f.safety.get(env.render!.workloadConsumerId!))?.startPermit).toBeNull();
        expect(await f.k8s.get(Resources.Secret!, env.podName + '-admission', env.namespace)).toBeUndefined();
        expect((await f.resources.api.get(input.id))?.spec['pod']).toMatchObject({ expectedPodUid: original.metadata.uid });
        expect(await f.resources.api.occupancy(f.projectId)).toBe(2);
      } finally { await f.close(); }
    }
  }, 15_000);
});
