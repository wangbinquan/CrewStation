import { expect, test } from 'bun:test';
import { TaskIdSchema } from '@crewstation/contracts';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { runtimeImageFixture } from './runtimeImageFixture';

const available = await testDatabaseAvailable();
test.skipIf(!available)('input credentials are issued for a fixed consumer, bound before provisioning completes, and never placed in ledger spec', async () => {
  const issued: unknown[] = [], bound: unknown[] = [];
  const f = await runtimeImageFixture(undefined, 'ledger', {
    taskInputEnv: async (input) => { issued.push(input); return { CS_OBJECT_INPUT_URL: 'http://api/inputs', CS_OBJECT_INPUT_TOKEN: 'private-input-token' }; },
    bindTaskInputs: async (...args) => { bound.push(args); },
  });
  try {
    const taskId = TaskIdSchema.parse(Bun.randomUUIDv7());
    const env = await f.runtime.api.createEnvironment({ serviceId: f.serviceId, kind: 'business', admission: { id: taskId, fingerprint: 'a'.repeat(64) }, businessStorage: 'isolated-v1', volumeMode: 'persistent', completionPolicy: 'archive-and-delete', objectInputsGeneration: 1 });
    expect(JSON.stringify(env)).not.toContain('private-input-token');
    const { values, pod } = await f.bind(taskId, false);
    const stored = await f.load(taskId);
    expect(values.CS_OBJECT_INPUT_TOKEN).toBe('private-input-token');
    expect(issued).toEqual([{ taskId, generation: 1, consumerId: stored.render!.workloadConsumerId }]);
    expect(bound).toEqual([[stored.render!.workloadConsumerId, pod.metadata.uid]]);
    expect((await f.load(taskId)).render?.objectInputsGeneration).toBe(1);
    expect(JSON.stringify(await f.resources.api.list({}))).not.toContain('private-input-token');
  } finally { await f.close(); }
});
