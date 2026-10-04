import type { RunnerBusinessReceipt, RunnerCommand } from '@crewstation/contracts';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { drizzleBusinessExecutionStore } from '../../adapters/persistence/businessExecutions';
import { developmentRegistration, developmentReceipt, developmentPage } from '../developmentUsageFixtures';
import { openRunner, sessionDeletionFixture } from './fixture';
import type { MigrationSet } from '@crewstation/persistence';

export async function cleanupFixture(migrations?: MigrationSet) {
  const processIdentity = { podUid: crypto.randomUUID(), containerId: 'containerd://' + 'a'.repeat(64), nodeUid: crypto.randomUUID(), nodeName: 'original-session-node',
    pid: process.pid, pidNamespace: '173', bootId: crypto.randomUUID(), startTicks: '91' };
  const f = await sessionDeletionFixture({ protectCurrent: async () => processIdentity, sweep: async () => {} }, migrations);
  const task = f.task(), runner = await openRunner(f.second.address, task, { businessExecutionV3: 1, developmentUsageV1: 1, developmentUsageStopV1: 1, usageObservationsV1: 1 });
  const business = drizzleBusinessExecutionStore(f.database.db);
  const receipt: RunnerBusinessReceipt = { executionId: 'original-business', attempt: 1, incarnation: crypto.randomUUID(), payloadDigest: jsonHash('original command'),
    phase: 'registered', lastSequence: 0, acknowledgedSequence: 0, outputBytes: 0, result: null };
  await business.register(task, receipt);
  const registration = developmentRegistration();
  registration.runtimeTaskId = task; registration.key.executionId = task; registration.identity.executionId = task; registration.identity.projectId = f.projectId;
  await f.second.module.api.registerDevelopmentUsage(registration);
  const context = { ...await f.context(), phase: 'stop' as const }, owner = f.first.module.api.deletionOwner!;
  const birth = (await f.database.db.execute<{ id: string }>('SELECT id FROM session.connection_births'))[0]!.id;
  const request = (command: RunnerCommand) => f.first.module.api.sendProjectDeletionCommand!(context, birth, command);
  const exchange = async (command: RunnerCommand, payload: unknown) => {
    const pending = request(command); const result = pending.catch((error: unknown) => error);
    const frame = await Promise.race([runner.next((candidate) => candidate.id === command.id),
      pending.then(() => { throw new Error('Cleanup reply arrived before its original Runner frame'); })]);
    runner.ws.send(JSON.stringify({ type: 'result', id: command.id, payload }));
    const value = await result; if (value instanceof Error) throw value;
    return { frame, value };
  };
  const commandId = () => newResourceId();
  return { ...f, newTask: f.task, task, runner, business, receipt, registration, context, owner, birth, request, exchange, commandId,
    developmentReceipt: (through = 0) => developmentReceipt(registration, through), developmentPage: (after: number, count: number) => developmentPage(registration, after, count) };
}
