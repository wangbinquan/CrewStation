import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { PlatformError } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { businessTaskMigrations } from '../wiring';
import { executionAgentFixture } from './executionAgentFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-034 Runner usage negotiation at business dispatch', () => {
  let database: TestDatabase;
  beforeEach(async () => { database = await createTestDatabase([businessTaskMigrations]); });
  afterEach(async () => { await database?.drop(); });
  for (const supported of [true, false]) test(`numeric evidence is selected only after positive capability discovery: ${supported}`, async () => {
    const fixture = await executionAgentFixture(database.db);
    expect((await fixture.request(fixture.path, fixture.input)).status).toBe(202);
    const original = fixture.runner.sendCommand, requested: Array<1 | undefined> = [];
    fixture.runner.sendCommand = async (id, command) => {
      if (command.type !== 'businessExecutionInfo') return original(id, command);
      requested.push(command.usageObservationsV1);
      if (!supported && command.usageObservationsV1 === 1) throw new PlatformError('precondition', 'old Runner', { code: 'unsupported_capability', capability: 'usageObservationsV1' });
      const base = await original(id, command) as object;
      return { ...base, ...(supported ? { usageObservationsV1: 1 } : {}) };
    };
    fixture.ready(); await fixture.module.api.v3.runOnce();
    expect(fixture.agentBehavior.starts).toBe(1);
    const sent = fixture.starts.find(({ command }) => command.type === 'startBusinessAgent')!.command;
    expect(sent.type === 'startBusinessAgent' && sent.usageObservationsV1).toBe(supported ? 1 : undefined);
    expect(requested).toEqual(supported ? [1] : [1, undefined]);
    await fixture.module.api.v3.runOnce(); expect(fixture.agentBehavior.starts).toBe(1);
  });
  test('a temporary discovery failure retries without silently using legacy capture', async () => {
    const fixture = await executionAgentFixture(database.db);
    expect((await fixture.request(fixture.path, fixture.input)).status).toBe(202);
    const original = fixture.runner.sendCommand; let failed = true;
    fixture.runner.sendCommand = async (id, command) => {
      if (command.type !== 'businessExecutionInfo') return original(id, command);
      expect(command.usageObservationsV1).toBe(1);
      if (failed) throw new Error('connection unavailable');
      return { ...await original(id, command) as object, usageObservationsV1: 1 };
    };
    fixture.ready(); await fixture.module.api.v3.runOnce(); expect(fixture.agentBehavior.starts).toBe(0);
    failed = false; await fixture.module.api.v3.runOnce(); expect(fixture.agentBehavior.starts).toBe(1);
  });
});
