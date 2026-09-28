import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { BusinessSubtaskV3Dto } from '@crewstation/contracts';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import type { ExecutionObservationAdmission } from '../ports/executionSubtasks';
import { businessTaskMigrations } from '../wiring';
import { agentImageResumeFixture } from './agentImageResumeFixture';
import { agentRuntimeImageFixture } from './agentRuntimeImageFixture';
import { executionAgentFixture } from './executionAgentFixture';
import { executionCommandFixture } from './executionCommandFixture';

const available = await testDatabaseAvailable();
let tdb: TestDatabase;
beforeAll(async () => { if (available) tdb = await createTestDatabase([businessTaskMigrations]); });
afterAll(async () => { await tdb?.drop(); });
type Admission = Parameters<ExecutionObservationAdmission['accept']>[0];

describe.skipIf(!available)('RFC-034 business attempt price acceptance', () => {
  test('Agent acceptance freezes resolved profile and execution identity before environment admission; replay does not capture again', async () => {
    const f = await executionAgentFixture(tdb.db), accepted: Admission[] = [];
    const port: ExecutionObservationAdmission = { accept: async (input) => { expect(f.creates).toHaveLength(0); accepted.push(input); } };
    const api = f.make({ executionObservations: port });
    const response = await api.request(f.path, f.input); expect(response.status).toBe(202);
    const view = await response.json() as BusinessSubtaskV3Dto;
    expect(accepted).toEqual([{ identity: { projectId: f.projectId, taskId: f.task.id, subtaskId: view.id, executionId: view.executionId, executionGeneration: 1 },
      profile: { id: f.computeId, revision: 1, protocol: 'opencode' } }]);
    expect(f.creates).toHaveLength(1);
    f.agentBehavior.revision = 2;
    const replay = await f.make({ executionObservations: port }).request(f.path, { ...f.input, fence: undefined });
    expect(replay.status).toBe(202); expect((await replay.json()).id).toBe(view.id); expect(accepted).toHaveLength(1);
    f.ready(); await api.module.api.v3.runOnce(); expect(f.agentBehavior.starts).toBe(1); expect(accepted).toHaveLength(1);
  });
  test('price acceptance failure leaves no admitted subtask or runtime; the same request can be retried', async () => {
    const f = await executionAgentFixture(tdb.db); let unavailable = true;
    const api = f.make({ executionObservations: { accept: async () => { if (unavailable) throw new Error('price capture unavailable'); } } });
    expect((await api.request(f.path, f.input)).status).toBe(500);
    expect(await (await api.request(f.path)).json()).toEqual({ items: [] }); expect(f.creates).toHaveLength(0); expect(f.agentBehavior.starts).toBe(0);
    unavailable = false;
    expect((await api.request(f.path, f.input)).status).toBe(202); expect(f.creates).toHaveLength(1);
  });
  // RFC-034 review regression: price preparation failed before business reserve, so image release is certain.
  test('failed price preparation releases the unused Agent image even for an ordinary transport error', async () => {
    const f = await agentRuntimeImageFixture(tdb.db), released: string[] = [];
    f.port.release = async (_snapshot, owner) => { released.push(owner.id); };
    const api = f.make({ executionObservations: { accept: async () => { throw new Error('price capture unavailable'); } } });
    const response = await api.request(f.path, f.input);
    expect(response.status).toBe(500); expect(f.reservations).toHaveLength(1);
    expect(released).toEqual([f.reservations[0]![1]]);
    expect(f.inputs).toHaveLength(0); expect(await (await api.request(f.path)).json()).toEqual({ items: [] });
  });
  test('fresh and resume failures release copied images while keeping the original execution and profile intact', async () => {
    for (const mode of ['fresh', 'resume', 'submit-resume'] as const) {
      // The fixture drives the global worker; isolate its pending queue from other test tasks.
      const isolated = await createTestDatabase([businessTaskMigrations]);
      try {
      const f = await agentImageResumeFixture(isolated.db), copied: string[] = [], released: string[] = [], accepted: Admission[] = [];
      f.port.restoreAgent = async (_project, _snapshot, _from, to) => { copied.push(to); };
      f.port.release = async (_snapshot, owner) => { released.push(owner.id); };
      let unavailable = true;
      const api = f.make({ executionObservations: { accept: async (input) => { accepted.push(input); if (unavailable) throw new Error('price capture unavailable'); } } });
      const path = mode === 'submit-resume' ? f.path : `${f.path}/${f.view.id}/retry`;
      const input = mode === 'submit-resume' ? f.resume : { requestKey: 'attempt-price', expectedAttempt: 1, resumePolicy: mode,
        ...(mode === 'resume' ? { resumeSessionId: 'image-session' } : {}), fence: f.input.fence };
      expect((await api.request(path, input)).status).toBe(500);
      expect(released).toEqual(copied); expect(copied).toHaveLength(1); expect(f.inputs).toHaveLength(1);
      expect(accepted[0]?.profile).toEqual({ id: f.computeId, revision: f.view.profileRevision!, protocol: 'opencode' });
      expect(accepted[0]?.identity.executionGeneration).toBe(mode === 'submit-resume' ? 1 : 2);
      expect(accepted[0]?.identity.executionId).not.toBe(f.view.executionId);
      unavailable = false;
      expect((await api.request(path, input)).status).toBe(202); expect(f.inputs).toHaveLength(2);
      expect(released).toHaveLength(1); expect(copied).toHaveLength(2);
      } finally { await isolated.drop(); }
    }
  });
  test('command retries keep distinct execution generations and never invent a model profile', async () => {
    const f = await executionCommandFixture(tdb.db), accepted: Admission[] = [];
    const api = f.make({ executionObservations: { accept: async (input) => { accepted.push(input); } } });
    f.behavior.disconnectAfterInfo = true;
    const first = await (await api.request(f.path, f.input)).json() as BusinessSubtaskV3Dto;
    expect((await api.request(`${f.path}/${first.id}/cancel`, { requestKey: 'cancel-price-attempt', expectedAttempt: 1, fence: f.fence })).status).toBe(202);
    f.behavior.disconnectAfterInfo = false; f.env.connected = true;
    const retry = { requestKey: 'price-new-attempt', expectedAttempt: 1, resumePolicy: 'fresh', fence: f.fence };
    const response = await api.request(`${f.path}/${first.id}/retry`, retry); expect(response.status).toBe(201);
    const second = await response.json() as BusinessSubtaskV3Dto;
    expect(accepted.map((entry) => entry.profile)).toEqual([null, null]);
    expect(accepted.map((entry) => entry.identity.executionGeneration)).toEqual([1, 2]);
    expect(accepted.map((entry) => entry.identity.executionId)).toEqual([first.executionId, second.executionId]);
    expect(second.executionId).not.toBe(first.executionId);
    expect((await api.request(`${f.path}/${first.id}/retry`, retry)).status).toBe(200); expect(accepted).toHaveLength(2);
  });
});
