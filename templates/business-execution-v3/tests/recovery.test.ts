import { afterEach, describe, expect, test } from 'bun:test';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '../../../packages/testkit';
import { Platform, type Fence } from '../src/client';
import { Store } from '../src/store';
import { consumeRecovery, type RecoveryClaim } from '../src/recovery';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('示例业务持久恢复收件', () => {
  let database: TestDatabase, store: Store;
  afterEach(async () => { await store?.db.close(); await database?.drop(); });
  const fixture = async () => {
    database = await createTestDatabase(); store = new Store(database.url); await store.migrate();
    const fence: Fence = { epoch: 1, instanceId: Bun.randomUUIDv7(), leaseId: Bun.randomUUIDv7() };
    await store.prepare(fence.epoch, fence.instanceId, 'active', new Date(Date.now() + 30_000).toISOString());
    const claim: RecoveryClaim = { claimId: Bun.randomUUIDv7(), expiresAt: new Date(Date.now() + 30_000).toISOString(), request: {
      id: Bun.randomUUIDv7(), state: 'claimed', target: { taskId: Bun.randomUUIDv7(), action: 'resume-task', expectedGeneration: 2, materialDigest: 'a'.repeat(64) },
    } };
    const calls: Array<{ path: string; body: Record<string, unknown> }> = [], effects = new Map<string, unknown>();
    const behavior = { loseReply: false, empty: false, capacity: false, calls: 0 };
    const platform = new Platform('http://platform', (async (url, options) => {
      const path = new URL(String(url)).pathname, body = JSON.parse(String(options?.body ?? '{}')) as Record<string, unknown>;
      calls.push({ path, body });
      if (path.endsWith('/claim')) return Response.json(behavior.empty ? null : claim);
      if (behavior.capacity) return Response.json({ error: 'quota_exceeded' }, { status: 429 });
      // Business intent must be committed before the external mutation.
      const rows = await store.db`SELECT request FROM execution_sample_recovery WHERE request_id=${claim.request.id}`;
      expect(rows[0]?.request.target).toEqual(claim.request.target);
      let result = effects.get(String(body.requestKey));
      if (!result) { behavior.calls++; result = { operationId: Bun.randomUUIDv7() }; effects.set(String(body.requestKey), result); }
      if (behavior.loseReply) throw new Error('reply lost after admission');
      return Response.json(result);
    }) as typeof fetch);
    return { fence, claim, platform, calls, behavior, effects };
  };
  test('先持久化意图，丢回执或已受理后重放同键仍只执行一次', async () => {
    const f = await fixture(); f.behavior.loseReply = true;
    await expect(consumeRecovery(f.platform, store, f.fence)).rejects.toThrow('reply lost');
    const first = f.calls.at(-1)!;
    expect(first.path).toBe(`/v3/business-tasks/${f.claim.request.target.taskId}/resume`);
    expect(first.body).toMatchObject({ requestKey: `recovery:${f.claim.request.id}`, expectedGeneration: 2, fence: f.fence });
    f.claim.claimId = Bun.randomUUIDv7(); f.behavior.loseReply = false;
    await consumeRecovery(f.platform, store, f.fence);
    expect(f.calls.at(-1)?.body).toMatchObject({ requestKey: first.body.requestKey, recovery: { recoveryRequestId: f.claim.request.id, claimId: f.claim.claimId } });
    expect(f.behavior.calls).toBe(1);
    const calls = f.calls.length;
    await consumeRecovery(f.platform, store, f.fence);
    expect(f.calls).toHaveLength(calls + 2); // reclaim and replay the same mutation key
    expect(f.calls.some((call) => call.path.endsWith('/succeed'))).toBe(false);
  });
  test('已绑定平台操作继续原键；容量错误和空队列不制造结果，fresh 不改原材料', async () => {
    const f = await fixture(); f.behavior.empty = true;
    await consumeRecovery(f.platform, store, f.fence); expect(f.calls).toHaveLength(1);
    f.behavior.empty = false; f.claim.request.target = { ...f.claim.request.target, action: 'retry-subtask', subtaskId: Bun.randomUUIDv7(), expectedAttempt: 1 };
    f.behavior.capacity = true;
    await expect(consumeRecovery(f.platform, store, f.fence)).rejects.toMatchObject({ status: 429 });
    const stored = await store.db`SELECT response FROM execution_sample_recovery WHERE request_id=${f.claim.request.id}`;
    expect(stored[0]?.response).toBeNull();
    f.behavior.capacity = false;
    await consumeRecovery(f.platform, store, f.fence);
    expect(f.calls.at(-1)?.body).toMatchObject({ expectedAttempt: 1, resumePolicy: 'fresh' });
    expect(f.calls.at(-1)?.body).not.toHaveProperty('runtimeImageVersionId');
    f.claim.request = { ...f.claim.request, id: Bun.randomUUIDv7(), state: 'running', operationId: Bun.randomUUIDv7() };
    const calls = f.calls.length;
    await consumeRecovery(f.platform, store, f.fence); expect(f.calls).toHaveLength(calls + 2);
  });
  test('未知动作明确拒绝；应用写屏障拒绝旧 holder，原 requestId 不可改变目标', async () => {
    const f = await fixture();
    f.claim.request.target.action = 'unsupported-future-action';
    await consumeRecovery(f.platform, store, f.fence);
    expect(f.calls.at(-1)?.path).toBe(`/v3/business-execution/recovery/${f.claim.request.id}/reject`);
    expect(f.calls.at(-1)?.body.reason).toBe('此示例版本不支持该恢复动作');
    f.claim.request.target.expectedGeneration++;
    await expect(consumeRecovery(f.platform, store, f.fence)).rejects.toThrow('恢复请求内容已变化');
    await store.prepare(2, Bun.randomUUIDv7(), 'active', new Date(Date.now() + 30_000).toISOString());
    await expect(consumeRecovery(f.platform, store, f.fence)).rejects.toThrow('写屏障');
  });
  test('重建与原生续跑沿原请求；缺失会话时拒绝，绝不降级为fresh', async () => {
    const f = await fixture(); f.claim.request.target.action = 'rebuild-workspace'; f.claim.request.target.volumeUid = 'original-volume';
    await consumeRecovery(f.platform, store, f.fence);
    expect(f.calls.at(-1)?.path).toBe(`/v3/business-tasks/${f.claim.request.target.taskId}/rebuild`);
    expect(f.calls.at(-1)?.body).toMatchObject({ requestKey: `recovery:${f.claim.request.id}`, expectedGeneration: 2, recovery: { recoveryRequestId: f.claim.request.id, claimId: f.claim.claimId } });
    f.claim.request = { ...f.claim.request, id: Bun.randomUUIDv7(), target: { ...f.claim.request.target, action: 'resume-subtask', subtaskId: Bun.randomUUIDv7(), expectedAttempt: 2, resumeSessionId: 'original-session' } };
    await consumeRecovery(f.platform, store, f.fence);
    expect(f.calls.at(-1)?.body).toMatchObject({ expectedAttempt: 2, resumePolicy: 'resume', resumeSessionId: 'original-session' });
    expect(f.calls.at(-1)?.body).not.toHaveProperty('runtimeImageVersionId');
    f.claim.request = { ...f.claim.request, id: Bun.randomUUIDv7(), target: { ...f.claim.request.target, resumeSessionId: undefined } };
    await consumeRecovery(f.platform, store, f.fence);
    expect(f.calls.at(-1)?.path).toBe(`/v3/business-execution/recovery/${f.claim.request.id}/reject`);
  });
  test('重新执行使用专用入口并保留原请求，重复认领不另行创建父任务', async () => {
    const f = await fixture(); f.claim.request.target.action = 'restart-task';
    await consumeRecovery(f.platform, store, f.fence);
    expect(f.calls.at(-1)?.path).toBe(`/v3/business-tasks/${f.claim.request.target.taskId}/restart`);
    expect(f.calls.at(-1)?.body).toMatchObject({ requestKey: `recovery:${f.claim.request.id}`, expectedGeneration: 2 });
    f.claim.request.resultTaskId = Bun.randomUUIDv7();
    await consumeRecovery(f.platform, store, f.fence);
    expect(f.behavior.calls).toBe(1);
    expect(f.calls.some((call) => call.path === '/v3/business-tasks')).toBe(false);
    expect(f.calls.at(-1)?.body).not.toHaveProperty('runtimeImageVersionId');
  });
});
