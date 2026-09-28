import { afterEach, expect, test } from 'bun:test';
import { chown, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { businessAgentDigestInput, RunnerResultPayloads, StartAgentCommandSchema } from '@crewstation/contracts';
import { startFakeSession } from './fakeSession';
import { echoDriverFactory } from './echoAgentDriver';
import { runningAsRoot, startTestRunner, WORKER_ID } from './testRunner';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const dispose of cleanups.splice(0).reverse()) await dispose(); });
async function directory(prefix: string) { const path = await mkdtemp(join(tmpdir(), prefix)); cleanups.push(() => rm(path, { recursive: true, force: true })); return path; }

test('durable Agent start over WS keeps native HOME, uses beforeStart and normalized events, and cancellation is replayable', async () => {
  const journal = await directory('cs-agent-journal-'), home = await directory('cs-agent-home-');
  if (runningAsRoot) await chown(home, WORKER_ID, WORKER_ID);
  await writeFile(join(home, 'session-sentinel'), 'native-session');
  const session = startFakeSession(); cleanups.push(() => session.stop());
  const drivers = echoDriverFactory(), tr = await startTestRunner(session.url, { businessJournalDir: journal, businessSessionDir: home }, { drivers }); cleanups.push(() => tr.dispose());
  await tr.runner.whenConnected();
  const info = RunnerResultPayloads.businessExecutionInfo.parse(await session.call({ id: 'info', type: 'businessExecutionInfo' }));
  expect(info.usageObservationsV1).toBeUndefined();
  const observed = RunnerResultPayloads.businessExecutionInfo.parse(await session.call({ id: 'observation-info', type: 'businessExecutionInfo', usageObservationsV1: 1 }));
  expect(observed.usageObservationsV1).toBe(1);
  const agent = StartAgentCommandSchema.parse({ id: 'agent', type: 'startAgent', agentId: 'agent', processAttemptId: 'attempt-one', compute: 'profile', profileRevision: 1,
    launch: { protocol: 'opencode', binaryPath: '/usr/bin/opencode' }, permission: 'full', mode: 'interactive', initialPrompt: 'hello protected-model-secret agent',
    beforeStart: { profile: '01a0bf5d-8f4b-7001-8458-107366e7de39', revision: 1, contentHash: 'hash', steps: [], vars: { APP_VALUE: 'platform-value' }, secrets: { KEY: 'protected-model-secret' }, configFile: { kind: 'none' }, captureOutput: false } });
  const digestNonce = 'a'.repeat(64), payloadDigest = new Bun.CryptoHasher('sha256').update(businessAgentDigestInput(agent, digestNonce)).digest('hex');
  const command = { id: 'start', type: 'startBusinessAgent', usageObservationsV1: observed.usageObservationsV1, executionId: 'agent-execution', attempt: 1, incarnation: info.incarnation, payloadDigest, digestNonce, agent };
  const first = RunnerResultPayloads.businessExecution.parse(await session.call(command)); expect(first.result).toBeNull();
  await session.waitFor(() => drivers.starts.length === 1 ? true : undefined);
  const started = drivers.starts[0]!; expect(started.context.env.HOME).toBe(home); expect(started.context.env.KEY).toBe('protected-model-secret'); expect(started.spec.businessEvents).toBe(true); expect(started.spec.usageObservationsV1).toBe(1);
  await session.call({ ...command, id: 'duplicate' }); expect(drivers.starts).toHaveLength(1);
  await expect(session.call({ ...command, id: 'mutated', agent: { ...agent, initialPrompt: 'changed' } })).rejects.toMatchObject({ code: 'execution_conflict' });
  await session.call({ id: 'cancel', type: 'cancelBusinessExecution', executionId: command.executionId });
  // Drain is event-driven and waits for the actual Agent stream and durable result.
  await tr.runner.stop();
  expect(await readFile(join(home, 'session-sentinel'), 'utf8')).toBe('native-session');
  expect(tr.logLines.join('\n')).not.toContain('protected-model-secret');
  const { ExecutionJournal } = await import('../src/exec/executionJournal');
  const reopened = new ExecutionJournal(journal, crypto.randomUUID(), { outputBytes: 64 * 1024 * 1024, spoolBytes: 64 * 1024 * 1024, eventBytes: 256 * 1024 });
  try {
    expect(reopened.get(command.executionId)).toMatchObject({ phase: 'finished', result: { reason: 'cancelled' } });
    const events = reopened.replay(command.executionId, 0); expect(events.some((event) => event.frame.type === 'agent' && event.frame.event.type === 'session')).toBe(true);
    expect(JSON.stringify(events)).not.toContain('protected-model-secret'); expect(JSON.stringify(events)).not.toContain('envKeys');
  } finally { reopened.close(); }
});
