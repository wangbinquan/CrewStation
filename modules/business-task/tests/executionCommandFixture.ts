import { expect } from 'bun:test';
import type { Database } from '@crewstation/persistence';
import type { BusinessControlDto, BusinessTaskV3Dto, RunnerBusinessReceipt, RunnerCommand } from '@crewstation/contracts';
import { newResourceId, PlatformError } from '@crewstation/kernel';
import { executionHttpFixture } from './executionHttpFixture';

export async function executionCommandFixture(db: Database, options?: Parameters<typeof executionHttpFixture>[2]) {
    const f = await executionHttpFixture(db, undefined, options), instanceId = newResourceId(), root = '/v3/business-execution/control';
    const lease = await (await f.request(`${root}/claim`, { instanceId })).json() as BusinessControlDto;
    const fence = { epoch: lease.epoch, leaseId: lease.leaseId!, instanceId };
    expect((await f.request(`${root}/activate`, { expectedEpoch: fence.epoch, leaseId: fence.leaseId, instanceId, preparationDigest: 'a'.repeat(64) })).status).toBe(200);
    const task = await (await f.request('/v3/business-tasks', { requestKey: 'parent', taskContractVersion: 'v1', fence })).json() as BusinessTaskV3Dto;
    const env = f.environments.get(task.id)!; env.state = 'running'; env.connected = true;
    const receipts = new Map<string, RunnerBusinessReceipt>(), commands: RunnerCommand[] = [];
    const behavior = { incarnation: newResourceId(), starts: 0, loseReply: false, unavailable: false, notSupported: false, disconnectAfterInfo: false };
    f.runner.sendCommand = async (_taskId, command) => {
      commands.push(command);
      if (behavior.notSupported) throw new PlatformError('precondition', 'old runner', { code: 'unsupported_capability' });
      if (behavior.unavailable) throw new Error('connection lost');
      if (command.type === 'businessExecutionInfo') { if (behavior.disconnectAfterInfo) env.connected = false; return { incarnation: behavior.incarnation, limits: { outputBytes: 1024, spoolBytes: 2048, eventBytes: 1024 } }; }
      if (command.type === 'getBusinessExecution') {
        const receipt = receipts.get(command.executionId); if (!receipt) throw new PlatformError('not_found', 'missing', { code: 'execution_not_found' }); return receipt;
      }
      if (command.type === 'cancelBusinessExecution') {
        const prior = receipts.get(command.executionId);
        if (!prior) throw new PlatformError('not_found', 'missing', { code: 'execution_not_found' });
        const receipt: RunnerBusinessReceipt = prior.phase === 'finished' ? prior : { ...prior, phase: 'finished', result: { reason: 'cancelled', exitCode: null, durationMs: 100 }, lastSequence: 2 };
        receipts.set(receipt.executionId, receipt); return receipt;
      }
      if (command.type === 'startBusinessCommand') {
        behavior.starts++;
        const receipt: RunnerBusinessReceipt = { executionId: command.executionId, attempt: command.attempt, payloadDigest: command.payloadDigest, incarnation: command.incarnation,
          phase: 'running', lastSequence: 1, acknowledgedSequence: 0, outputBytes: 0, result: null };
        receipts.set(receipt.executionId, receipt);
        if (behavior.loseReply) throw new Error('reply lost after start'); return receipt;
      }
      throw new Error(`unexpected command ${command.type}`);
    };
    const path = `/v3/business-tasks/${task.id}/subtasks`;
    const input = { kind: 'command', requestKey: 'command', name: 'build', argv: ['sh', '-c', 'echo hello'], env: { APP_TOKEN: 'secret-not-for-storage' }, fence };
    return { ...f, task, env, path, input, fence, behavior, receipts, commands };
  }
