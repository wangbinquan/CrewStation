import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { ProjectDeletionContext } from '@crewstation/contracts';
import { noopLogger } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { projectDeletionController } from '../application/deletion/controller';
import type { DeletionFixture } from './deletionFixture';
import { deletionFixture } from './deletionFixture';

const available = await testDatabaseAvailable(); let f: DeletionFixture;
beforeAll(async () => { if (available) f = await deletionFixture(); });
afterAll(async () => { await f?.database.drop(); });
const controllerWithObserver = (observeTerminating: (context: ProjectDeletionContext) => Promise<void>) => projectDeletionController({
  intents: f.intents, owners: f.external.owners.map((owner) => owner.participant === 'resources' ? { ...owner, observeTerminating } : owner),
  workerOwner: 'stop-dependency-test', isAdmin: async () => true, enqueue: async () => {}, logger: noopLogger,
});

describe.skipIf(!available)('停止依赖与只观测（真实 PG＋有状态外部替身）', () => {
  test('原运行停止后仍等待观测排空，数字提交完成后才关闭 Session 和资源', async () => {
    const { value, operation } = await f.start(), observed: ProjectDeletionContext[] = [];
    const controller = controllerWithObserver(async (context) => { await f.api.assertProjectDeletionGrant(context); observed.push(context); });
    f.external.waitStop.add('observability');
    try {
      await controller.advance(operation.id); const waiting = await f.controller.read(f.admin, operation.id);
      expect(waiting.receipts.some((receipt) => receipt.participant === 'task-runtime' && receipt.phase === 'stop')).toBe(true);
      for (const participant of ['session', 'resources', 'cluster-control'] as const) {
        expect(f.external.calls.some((call) => call.projectId === value.id && call.participant === participant && call.phase === 'stop')).toBe(false);
        expect(waiting.receipts.some((receipt) => receipt.participant === participant && receipt.phase === 'stop')).toBe(false);
      }
      expect(observed).toHaveLength(1);
    } finally { f.external.waitStop.delete('observability'); }
    f.elapse(15_001); await controller.advance(operation.id);
    expect((await f.controller.read(f.admin, operation.id)).state).toBe('succeeded');
    const stopCalls = f.external.calls.filter((call) => call.projectId === value.id && call.phase === 'stop').map((call) => call.participant);
    expect(stopCalls.lastIndexOf('observability')).toBeLessThan(stopCalls.indexOf('session'));
    expect(stopCalls.indexOf('session')).toBeLessThan(stopCalls.indexOf('resources'));
  }, 15_000);
  test('原 TaskRuntime 仍在排空时，只观测已终结 Pod，不关闭 Session 或调用资源 stop', async () => {
    const { value, operation } = await f.start(), observed: ProjectDeletionContext[] = [];
    const controller = controllerWithObserver(async (context) => { await f.api.assertProjectDeletionGrant(context); observed.push(context); });
    f.external.waitStop.add('task-runtime');
    try {
      await controller.advance(operation.id); const waiting = await f.controller.read(f.admin, operation.id);
      expect(waiting).toMatchObject({ state: 'running', phase: 'stop' }); expect(observed).toHaveLength(1);
      const stopped = waiting.receipts.find((receipt) => receipt.phase === 'stop' && receipt.participant === 'business-task');
      expect(stopped).toBeDefined();
      expect(observed[0]).toMatchObject({ operationId: operation.id, generation: stopped!.generation, phase: 'stop', target: { id: value.id }, confirmed: { participant: 'resources' } });
      for (const participant of ['session', 'resources', 'cluster-control'] as const) {
        expect(f.external.calls.some((call) => call.projectId === value.id && call.participant === participant && call.phase === 'stop')).toBe(false);
        expect(waiting.receipts.some((receipt) => receipt.participant === participant && receipt.phase === 'stop')).toBe(false);
        expect(f.external.state(participant, value.id).running).toBe(true);
      }
      expect(f.external.calls.some((call) => call.projectId === value.id && call.phase === 'purge')).toBe(false);
    } finally { f.external.waitStop.delete('task-runtime'); }
    f.elapse(15_001); await controller.advance(operation.id);
    expect((await f.controller.read(f.admin, operation.id)).state).toBe('succeeded'); expect(observed).toHaveLength(1);
  }, 15_000);
  test('资源停止等待其他来源的实际回执，不把数字任务完成当成全部消费者停止', async () => {
    const { value, operation } = await f.start(); let observations = 0;
    const controller = controllerWithObserver(async (context) => { await f.api.assertProjectDeletionGrant(context); observations++; });
    f.external.waitStop.add('scm');
    try {
      await controller.advance(operation.id); const waiting = await f.controller.read(f.admin, operation.id);
      expect(waiting.receipts.some((receipt) => receipt.participant === 'session' && receipt.phase === 'stop')).toBe(true);
      expect(waiting.receipts.some((receipt) => receipt.participant === 'resources' && receipt.phase === 'stop')).toBe(false);
      expect(f.external.calls.some((call) => call.projectId === value.id && call.participant === 'resources' && call.phase === 'stop')).toBe(false);
      expect(f.external.state('resources', value.id).running).toBe(true); expect(observations).toBe(1);
    } finally { f.external.waitStop.delete('scm'); }
    f.elapse(15_001); await controller.advance(operation.id); expect((await f.controller.read(f.admin, operation.id)).state).toBe('succeeded');
  }, 15_000);
  test('停止观测来源报错就保留原范围并阻断，恢复后沿原操作继续', async () => {
    const { value, operation } = await f.start(); let unavailable = true;
    const controller = controllerWithObserver(async (context) => { await f.api.assertProjectDeletionGrant(context); if (unavailable) throw new Error('stop source unavailable'); });
    f.external.waitStop.add('task-runtime');
    try {
      await expect(controller.advance(operation.id)).rejects.toMatchObject({ kind: 'precondition' });
      const blocked = await f.controller.read(f.admin, operation.id);
      expect(blocked).toMatchObject({ state: 'needs-attention', blockers: [{ participant: 'resources', code: 'owner-failed' }] });
      expect(f.external.state('resources', value.id)).toMatchObject({ running: true, exists: true, storage: true, metadata: true });
      expect(blocked.receipts.some((receipt) => receipt.phase === 'purge' || receipt.participant === 'resources' && receipt.phase === 'stop')).toBe(false);
      unavailable = false; await f.controller.retry(f.admin, operation.id); await controller.advance(operation.id);
      expect((await f.controller.read(f.admin, operation.id)).state).toBe('running');
    } finally { f.external.waitStop.delete('task-runtime'); }
    f.elapse(15_001); await controller.advance(operation.id); expect((await f.controller.read(f.admin, operation.id)).state).toBe('succeeded');
  }, 15_000);
});
