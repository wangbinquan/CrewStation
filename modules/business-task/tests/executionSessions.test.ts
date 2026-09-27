import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { BusinessSubtaskV3Dto, RunnerBusinessEvent } from '@crewstation/contracts';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { businessTaskMigrations } from '../wiring';
import { executionAgentFixture } from './executionAgentFixture';
import { drizzleExecutionSubtasks } from '../adapters/persistence/execution/subtasks';
import { drizzleExecutionProjection } from '../adapters/persistence/execution/projection';
import { drizzleExecutionSessions } from '../adapters/persistence/sessions/repository';
import { precondition } from '@crewstation/kernel';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-027 native session exclusive persistent home', () => {
  let tdb: TestDatabase;
  beforeEach(async () => { tdb = await createTestDatabase([businessTaskMigrations]); });
  afterEach(async () => { await tdb?.drop(); });
  async function completedAgent(configure?: (fixture: Awaited<ReturnType<typeof executionAgentFixture>>) => Promise<void>) {
    const f = await executionAgentFixture(tdb.db);
    await configure?.(f);
    const view = await (await f.request(f.path, f.input)).json() as BusinessSubtaskV3Dto;
    const env = f.ready();
    for (let i = 0; i < 5 && !f.receipts.has(view.executionId); i++) await f.module.api.v3.runOnce();
    expect(f.receipts.has(view.executionId)).toBe(true);
    const store = drizzleExecutionSubtasks(tdb.db), projection = drizzleExecutionProjection(tdb.db), sessions = drizzleExecutionSessions(tdb.db);
    const subtask = (await store.get(f.serviceId, f.task.id, view.id))!, at = new Date().toISOString();
    const events: RunnerBusinessEvent[] = [
      { sequence: 1, occurredAt: at, frame: { type: 'state', state: 'running' } },
      ...['native-one', 'native-alias'].map((sessionId, index): RunnerBusinessEvent => ({ sequence: index + 2, occurredAt: at, frame: { type: 'agent', event: { agentId: view.executionId, seq: index + 1, at, type: 'session', sessionId } } })),
      { sequence: 4, occurredAt: at, frame: { type: 'result', result: { exitCode: 0, reason: 'exited', durationMs: 100 } } },
    ];
    const receipt = { ...f.receipts.get(view.executionId)!, phase: 'finished' as const, lastSequence: 4, result: { exitCode: 0, reason: 'exited' as const, durationMs: 100 } };
    await projection.pending(20);
    await projection.append(subtask, { taskId: env.id, receipt, persistedThrough: 4, acknowledgedThrough: 4, complete: true }, events);
    const resume = { ...f.input, requestKey: 'resume-one', prompt: 'continue', resumeSessionId: 'native-one' };
    return { ...f, view, env, store, sessions, resume };
  }
  test('native aliases share one writer lease; resource release and pinned revision govern concurrent resume', async () => {
    const f = await completedAgent();
    expect((await f.request(f.path, f.resume)).status).toBe(409);
    await f.module.api.v3.runOnce(); expect(f.env.state).toBe('releasing');
    expect((await f.sessions.get(f.serviceId, f.task.id, 'native-one'))?.state).toBe('occupied');
    f.env.state = 'released'; f.env.native = { state: 'finished' }; await f.module.api.v3.runOnce();
    expect((await f.sessions.get(f.serviceId, f.task.id, 'native-one'))?.state).toBe('idle');
    expect((await f.request(f.path, { ...f.resume, cwd: '/work/other' })).status).toBe(409);
    f.agentBehavior.revision = 2; const resolves = f.agentBehavior.resolveCount;
    const responses = await Promise.all([f.request(f.path, f.resume), f.request(f.path, { ...f.resume, requestKey: 'resume-alias', resumeSessionId: 'native-alias' })]);
    expect(responses.map((r) => r.status).sort()).toEqual([202, 409]); expect(f.agentBehavior.resolveCount).toBe(resolves);
    const resumed = await responses.find((r) => r.status === 202)!.json() as BusinessSubtaskV3Dto;
    expect(resumed.profileRevision).toBe(1); expect(f.creates).toHaveLength(2);
    expect(f.creates[1]!.businessSession).toEqual({ key: f.creates[0]!.id, mode: 'existing' });
    const next = f.environments.get(f.creates[1]!.id)!; next.state = 'running'; next.connected = true;
    await f.module.api.v3.runOnce();
    const launch = f.starts.find((entry) => entry.command.type === 'startBusinessAgent' && entry.command.executionId === resumed.executionId)!;
    expect(launch.command).toMatchObject({ agent: { profileRevision: 1, initialPrompt: 'continue', resumeSessionId: expect.stringMatching(/^native-/) } });
  });
  test('fresh retry keeps its original revision but creates a new home and has one successor', async () => {
    const f = await completedAgent(); f.agentBehavior.revision = 3;
    const resolves = f.agentBehavior.resolveCount;
    const retryPath = `${f.path}/${f.view.id}/retry`, body = { requestKey: 'fresh-retry', expectedAttempt: 1, resumePolicy: 'fresh', fence: f.fence };
    const response = await f.request(retryPath, body); expect(response.status).toBe(202);
    const fresh = await response.json() as BusinessSubtaskV3Dto;
    // I34: changing the default must not change the environment of a fresh retry.
    expect(fresh).toMatchObject({ attempt: 2, previousId: f.view.id, profileRevision: 1 }); expect(fresh.sessionId).toBeUndefined();
    expect(f.agentBehavior.resolveCount).toBe(resolves);
    expect(f.creates[1]!.businessSession).toEqual({ key: f.creates[1]!.id, mode: 'create' });
    expect((await f.request(retryPath, { ...body, fence: undefined })).status).toBe(202);
    expect((await f.request(retryPath, { ...body, requestKey: 'another-successor' })).status).toBe(409);
  });
  test('resume retry uses the original snapshot and directory', async () => {
    const other = await completedAgent(); other.env.state = 'released'; other.env.native = { state: 'finished' }; await other.module.api.v3.runOnce();
    other.agentBehavior.revision = 5;
    const resumed = await other.request(`${other.path}/${other.view.id}/retry`, { requestKey: 'resume-retry', expectedAttempt: 1, resumePolicy: 'resume', resumeSessionId: 'native-one', fence: other.fence });
    expect(resumed.status).toBe(202); expect(await resumed.json()).toMatchObject({ attempt: 2, previousId: other.view.id, profileRevision: 1 });
    expect(other.creates[1]!.businessSession).toEqual({ key: other.creates[0]!.id, mode: 'existing' });
  });
  test('fresh retains pinned provider credentials and fails if that version is revoked', async () => {
    let revoked = false;
    const stamps: string[] = [];
    const f = await completedAgent(async (fixture) => {
      const launch = await fixture.compute.launchMaterial({ profileId: fixture.computeId, revision: 1 });
      fixture.compute.pinLaunchVersion = async () => 'provider-version-one';
      fixture.compute.launchMaterialAt = async (ref, stamp) => {
        stamps.push(stamp); expect(ref.revision).toBe(1);
        if (revoked) throw precondition('原凭据已撤销', { code: 'secret_version_unavailable' });
        return launch;
      };
    });
    f.agentBehavior.providerKey = 'provider-secret-two'; f.agentBehavior.revision = 9;
    f.compute.pinLaunchVersion = async () => { throw new Error('retry must not repin'); };
    const path = `${f.path}/${f.view.id}/retry`, body = { requestKey: 'pinned-credential-retry', expectedAttempt: 1, resumePolicy: 'fresh', fence: f.fence };
    revoked = true; expect((await f.request(path, body)).status).toBe(412); expect(f.creates).toHaveLength(1);
    revoked = false; const response = await f.request(path, body); expect(response.status).toBe(202);
    const view = await response.json() as BusinessSubtaskV3Dto;
    const env = f.environments.get(f.creates[1]!.id)!; env.state = 'running'; env.connected = true;
    await f.module.api.v3.runOnce();
    const start = f.starts.find((entry) => entry.command.type === 'startBusinessAgent' && entry.command.executionId === view.executionId);
    expect(start?.command).toMatchObject({ agent: { profileRevision: 1, beforeStart: { secrets: { PROVIDER_KEY: 'provider-secret-one' } } } });
    expect(new Set(stamps)).toEqual(new Set(['provider-version-one']));
  });
  test('fresh cannot attach the old execution snapshot to a replacement volume', async () => {
    const f = await completedAgent();
    f.environments.get(f.task.id)!.businessWorkspace!.volumeUid = 'replacement-volume';
    expect((await f.request(`${f.path}/${f.view.id}/retry`, { requestKey: 'changed-volume', expectedAttempt: 1, resumePolicy: 'fresh', fence: f.fence })).status).toBe(409);
    expect(f.creates).toHaveLength(1);
  });
  test('missing runtime record and changed PVC UID cannot authorize a new writer', async () => {
    const f = await completedAgent(); f.environments.delete(f.env.id);
    await f.module.api.v3.runOnce();
    expect((await f.store.get(f.serviceId, f.task.id, f.view.id))?.runtimeReleased).toBe(false);
    expect((await f.request(f.path, f.resume)).status).toBe(409);
    f.environments.set(f.env.id, { ...f.env, state: 'released', native: { state: 'finished' } }); await f.module.api.v3.runOnce();
    f.environments.get(f.task.id)!.businessWorkspace!.volumeUid = 'replacement-volume';
    const response = await f.request(f.path, f.resume); expect(response.status).toBe(409);
    expect(f.creates).toHaveLength(1);
    const other = await executionAgentFixture(tdb.db);
    expect((await other.request(other.path, { ...other.input, resumeSessionId: 'native-one' })).status).toBe(404);
  });
});
