import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import type { BusinessOperationDto, RuntimeImageExecutionSnapshot } from '@crewstation/contracts';
import { businessTaskMigrations } from '../wiring';
import { agentImageResumeFixture } from './agentImageResumeFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-028 closed business task image references', () => {
  let db: TestDatabase;
  beforeEach(async () => { db = await createTestDatabase([businessTaskMigrations]); });
  afterEach(async () => { await db?.drop(); });
  test('only confirmed physical close releases parent and Agent references; failure survives controller restart', async () => {
    const f = await agentImageResumeFixture(db.db), root = `/v3/business-tasks/${f.task.id}`;
    const released: Array<{ type: string; id: string }> = [];
    let allowPhysicalClose = false, failReferenceRelease = true;
    f.environmentPort.releaseEnvironment = async (id) => {
      const env = f.environments.get(id)!; env.state = allowPhysicalClose ? 'released' : 'releasing'; env.connected = false; return env;
    };
    Object.assign(f.port, { release: async (_snapshot: RuntimeImageExecutionSnapshot, owner: { type: string; id: string }) => {
      if (failReferenceRelease) throw new Error('image owner unavailable');
      released.push(owner);
    } });
    const operation = await (await f.request(`${root}/close`, { requestKey: 'close-images', expectedGeneration: 1, fence: f.input.fence })).json() as BusinessOperationDto;
    expect(operation.state).toBe('pending'); expect(released).toEqual([]);
    const parent = f.environments.get(f.task.id)!; parent.state = 'released';
    const restarted = f.make(); await restarted.module.api.v3.runOnce();
    // Physical completion cannot lose a failed reference-release operation.
    expect(await (await restarted.request(`${root}/operations/${operation.operationId}`)).json()).toMatchObject({ state: 'pending' });
    failReferenceRelease = false; allowPhysicalClose = true;
    for (let i = 0; i < 3; i++) await restarted.module.api.v3.runOnce();
    expect(await (await restarted.request(`${root}/operations/${operation.operationId}`)).json()).toMatchObject({ state: 'succeeded' });
    expect(released).toEqual([{ type: 'agent', id: f.env.id }, { type: 'task', id: f.task.id }]);
    expect((await f.request(`${f.path}/${f.view.id}/retry`, { requestKey: 'closed-retry', expectedAttempt: 1, resumePolicy: 'fresh', fence: f.input.fence })).status).toBe(412);
  });
  test('a terminal Agent with a live Pod keeps both references until resource release is confirmed', async () => {
    const f = await agentImageResumeFixture(db.db, false), root = `/v3/business-tasks/${f.task.id}`, released: string[] = [];
    f.port.release = async (_snapshot, owner) => { released.push(owner.id); };
    f.environmentPort.releaseEnvironment = async (id) => {
      const env = f.environments.get(id)!; if (id === f.task.id) env.state = 'released'; return env;
    };
    const operation = await (await f.request(`${root}/close`, { requestKey: 'live-agent-close', expectedGeneration: 1, fence: f.input.fence })).json() as BusinessOperationDto;
    expect(operation.state).toBe('pending'); expect(released).toEqual([]);
    await f.module.api.v3.runOnce(); expect(released).toEqual([]);
    f.env.state = 'released'; f.env.native = { state: 'finished' };
    for (let i = 0; i < 3; i++) await f.module.api.v3.runOnce();
    expect(await (await f.request(`${root}/operations/${operation.operationId}`)).json()).toMatchObject({ state: 'succeeded' });
    expect(released).toEqual([f.env.id, f.task.id]);
  });
  test('pause preserves all image references for later recovery', async () => {
    const f = await agentImageResumeFixture(db.db), released: string[] = [];
    f.port.release = async (_snapshot, owner) => { released.push(owner.id); };
    f.environmentPort.pauseEnvironment = async (id) => {
      const env = f.environments.get(id)!; env.state = 'paused'; env.connected = false; return env;
    };
    expect(await (await f.request(`/v3/business-tasks/${f.task.id}/pause`, { requestKey: 'pause-images', expectedGeneration: 1, fence: f.input.fence })).json()).toMatchObject({ state: 'succeeded' });
    expect(released).toEqual([]);
  });
});
