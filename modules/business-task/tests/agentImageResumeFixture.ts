import { expect } from 'bun:test';
import type { BusinessSubtaskV3Dto, RunnerBusinessReceipt, RunnerBusinessEvent } from '@crewstation/contracts';
import type { Database } from '@crewstation/persistence';
import { newResourceId, PlatformError } from '@crewstation/kernel';
import { agentRuntimeImageFixture } from './agentRuntimeImageFixture';
import { drizzleExecutionSubtasks } from '../adapters/persistence/execution/subtasks';
import { drizzleExecutionProjection } from '../adapters/persistence/execution/projection';

export async function agentImageResumeFixture(db: Database, releaseRuntime = true) {
  const f = await agentRuntimeImageFixture(db);
  const response = await f.request(f.path, { ...f.input, runtimeImageVersionId: f.explicitVersion });
  expect(response.status).toBe(202);
  const view = await response.json() as BusinessSubtaskV3Dto, env = f.environments.get(f.inputs[0]!.id)!;
  const incarnation = newResourceId(); let receipt: RunnerBusinessReceipt | undefined;
  f.runner.sendCommand = async (_id, command) => {
    if (command.type === 'businessExecutionInfo') return { incarnation, limits: { outputBytes: 1024, spoolBytes: 2048, eventBytes: 1024 } };
    if (command.type === 'getBusinessExecution') { if (receipt) return receipt; throw new PlatformError('not_found', 'missing', { code: 'execution_not_found' }); }
    if (command.type === 'startBusinessAgent') {
      receipt = { executionId: command.executionId, attempt: command.attempt, payloadDigest: command.payloadDigest, incarnation, phase: 'running', lastSequence: 1, acknowledgedSequence: 0, outputBytes: 0, result: null }; return receipt;
    }
    throw new Error(`unexpected ${command.type}`);
  };
  env.connected = true; env.state = 'running'; env.native = { state: 'running' };
  await f.module.api.v3.runOnce(); expect(receipt).toBeDefined();
  const store = drizzleExecutionSubtasks(db), projection = drizzleExecutionProjection(db), at = new Date().toISOString();
  const subtask = (await store.get(f.serviceId, f.task.id, view.id))!;
  const events: RunnerBusinessEvent[] = [
    { sequence: 1, occurredAt: at, frame: { type: 'state', state: 'running' } },
    { sequence: 2, occurredAt: at, frame: { type: 'agent', event: { agentId: view.executionId, seq: 1, at, type: 'session', sessionId: 'image-session' } } },
    { sequence: 3, occurredAt: at, frame: { type: 'result', result: { exitCode: 0, reason: 'exited', durationMs: 10 } } },
  ];
  await projection.pending(20);
  await projection.append(subtask, { taskId: env.id, receipt: { ...receipt!, phase: 'finished', lastSequence: 3, result: { exitCode: 0, reason: 'exited', durationMs: 10 } }, persistedThrough: 3, acknowledgedThrough: 3, complete: true }, events);
  if (releaseRuntime) {
    env.state = 'released'; env.native = { state: 'finished' };
    await f.module.api.v3.runOnce();
  }
  return { ...f, view, env, resume: { ...f.input, requestKey: 'resume-image', resumeSessionId: 'image-session', prompt: 'continue' } };
}
