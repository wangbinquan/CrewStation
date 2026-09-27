import { afterEach, describe, expect, test } from 'bun:test';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { newResourceId } from '@crewstation/kernel';
import { businessTaskMigrations } from '../wiring';
import { agentImageResumeFixture } from './agentImageResumeFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-028 business owner proof for image reclamation', () => {
  let db: TestDatabase;
  afterEach(async () => { await db?.drop(); });
  test('absent/wrong ownership stays unknown; terminal Agent stays active until irreversible parent closure', async () => {
    db = await createTestDatabase([businessTaskMigrations]); const f = await agentImageResumeFixture(db.db);
    const query = { projectId: f.projectId, versionId: f.view.runtimeImage!.versionId, ownerType: 'agent', ownerId: f.env.id };
    const read = f.module.api.imageReferenceState;
    expect(await read(query)).toBe('active');
    expect(await read({ ...query, ownerId: newResourceId() })).toBe('unknown');
    expect(await read({ ...query, projectId: newResourceId() })).toBe('unknown');
    expect(await read({ ...query, versionId: newResourceId() })).toBe('unknown');
    expect(await read({ ...query, ownerType: 'release' })).toBe('unknown');
    f.port.release = async () => {};
    f.environmentPort.releaseEnvironment = async (id) => { const env = f.environments.get(id)!; env.state = 'released'; env.connected = false; return env; };
    expect(await (await f.request(`/v3/business-tasks/${f.task.id}/close`, { requestKey: 'close-for-proof', expectedGeneration: 1, fence: f.input.fence })).json()).toMatchObject({ state: 'succeeded' });
    expect(await f.make().module.api.imageReferenceState(query)).toBe('released');
    expect(await read({ ...query, ownerType: 'task', ownerId: f.task.id, versionId: f.task.runtimeImage!.versionId })).toBe('released');
    expect((await f.request(`${f.path}/${f.view.id}/retry`, { requestKey: 'no-revive', expectedAttempt: 1, resumePolicy: 'fresh', fence: f.input.fence })).status).toBe(412);
  });
});
