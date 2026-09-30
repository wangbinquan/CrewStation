import { afterEach, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectIdSchema, StartAgentCommandSchema, TaskIdSchema } from '@crewstation/contracts';
import { DevelopmentUsageJournal } from '../src/agents/developmentUsageJournal';
import { developmentIntentDigest } from '../src/agents/developmentStartIntent';
import { echoDriverFactory } from './echoAgentDriver';
import { startFakeSession } from './fakeSession';
import { launchSpec, profileFields } from './profileFixtures';
import { startTestRunner, TEST_TASK_ID } from './testRunner';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const end of cleanups.splice(0).reverse()) await end(); });
const projectId = ProjectIdSchema.parse('019f0000-0000-7000-8000-000000000001');
const workspaceTaskId = TaskIdSchema.parse('019f0000-0000-7000-8000-000000000002');
const agentId = '019f0000-0000-7000-8000-000000000004';
function ordinary(id: string) {
  return StartAgentCommandSchema.parse({ id, type: 'startAgent', agentId, ...profileFields(agentId, { launch: launchSpec('opencode') }), mode: 'oneshot', initialPrompt: 'fixture' });
}
function numeric(command: ReturnType<typeof ordinary>, journalId: string, incarnation: string) {
  const intent = { version: 1 as const, identity: { sourceKind: 'development-agent' as const, projectId, taskId: workspaceTaskId, executionId: TEST_TASK_ID, executionGeneration: 1 as const, agentId },
    profileId: command.beforeStart.profile, profileRevision: command.profileRevision, launch: command.launch, permission: command.permission, mode: command.mode,
    initialPrompt: command.initialPrompt ?? null, cwd: null, resumeSessionId: null, systemPrompt: null, mcp: [], nativeUsageLineageKey: 'fixture-headless' };
  const base = { intent, digestNonce: 'a'.repeat(64) };
  return { ...command, developmentUsage: { ...base, key: { executionId: TEST_TASK_ID, journalId, incarnation, payloadDigest: developmentIntentDigest(base) } } };
}
test('real Runner retains selected admission across unavailable journals and a restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cs-admission-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const session = startFakeSession(); cleanups.push(() => session.stop());
  const drivers = echoDriverFactory();
  const options = { version: 1 as const, directory: join(root, 'missing-journal'), bindingDirectory: join(root, 'missing-binding'), projectId, workspaceTaskId, podUid: 'fixture-pod' };
  for (let attempt = 0; attempt < 2; attempt++) {
    const tr = await startTestRunner(session.url, { developmentUsage: options }, { drivers });
    cleanups.push(() => tr.dispose()); await tr.runner.whenConnected();
    const hello = session.hellos.at(-1)!;
    expect(hello.capabilities.developmentStartAgentFenceV1).toBe(1);
    expect(hello.capabilities.developmentUsageV1).toBeUndefined();
    expect(hello.capabilities.developmentNativeSourceV1).toBeUndefined();
    await expect(session.call(ordinary('ordinary-' + attempt))).rejects.toMatchObject({ code: 'development_usage_required' });
    await expect(session.call(numeric(ordinary('numeric-' + attempt), randomUUID(), randomUUID()))).rejects.toMatchObject({ code: 'development_usage_unsupported' });
    expect(drivers.starts).toHaveLength(0); expect(session.eventsOf('agent')).toHaveLength(0);
    await tr.runner.stop(); tr.runner.link.close();
  }
});
test('an actually injected journal selects the fence and still accepts the original digital admission', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cs-admission-journal-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const journal = new DevelopmentUsageJournal(root, { projectId, workspaceTaskId, runtimeTaskId: TEST_TASK_ID, podUid: 'fixture-pod' }, randomUUID());
  const session = startFakeSession(); cleanups.push(() => session.stop());
  const drivers = echoDriverFactory(), tr = await startTestRunner(session.url, {}, { drivers, developmentUsageJournal: journal });
  cleanups.push(() => tr.dispose()); await tr.runner.whenConnected();
  expect(session.hellos[0]?.capabilities).toMatchObject({ developmentStartAgentFenceV1: 1, developmentUsageV1: 1, developmentUsageStopV1: 1 });
  await expect(session.call(ordinary('without-admission'))).rejects.toMatchObject({ code: 'development_usage_required' });
  expect(journal.info().receipt).toBeNull(); expect(drivers.starts).toHaveLength(0);
  const command = numeric(ordinary('original-admission'), journal.journalId, journal.incarnation);
  await session.call(command); await session.waitForEvent('agent', (event) => event.event.type === 'completed');
  expect(drivers.starts).toHaveLength(1); expect(journal.info(command.developmentUsage.key).receipt?.identity).toEqual(command.developmentUsage.intent.identity);
});
test('an unselected legacy Runner omits the fence and preserves ordinary Agent startup', async () => {
  const session = startFakeSession(); cleanups.push(() => session.stop());
  const drivers = echoDriverFactory(), tr = await startTestRunner(session.url, {}, { drivers });
  cleanups.push(() => tr.dispose()); await tr.runner.whenConnected();
  expect(session.hellos[0]?.capabilities.developmentStartAgentFenceV1).toBeUndefined();
  await session.call(ordinary('legacy')); await session.waitForEvent('agent', (event) => event.event.type === 'completed');
  expect(drivers.starts).toHaveLength(1);
});
