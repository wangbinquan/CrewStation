import { expect, test } from 'bun:test';
import type { ProjectDeletionsResource } from '@crewstation/api-client';
import { AcceptProjectDeletionSchema, ProjectDeletionOperationSchema, ProjectIdSchema } from '@crewstation/contracts';
import type { AcceptProjectDeletion, ProjectDeletionOperation, ProjectDeletionPlan } from '@crewstation/contracts';
import { ProjectDeletionSession } from '../features/projects/model/deletionSession';
import type { PendingDeletionRequest } from '../features/projects/model/deletionSession';
import { deletionOperation, deletionPlan, deletionProjectId } from './projectDeletionFixture';

function fixture() {
  const calls: string[] = [], sent: AcceptProjectDeletion[] = [], retained = new Map<string, PendingDeletionRequest>();
  const plan = deletionPlan(), operation = deletionOperation(); let found: ProjectDeletionOperation | undefined; let now = Date.now();
  const api: ProjectDeletionsResource = {
    find: async () => { calls.push('find'); return found; }, prepare: async () => { calls.push('prepare'); return plan; },
    accept: async (_id, input) => { calls.push('accept'); sent.push(structuredClone(input)); return operation; },
    get: async () => { calls.push('get'); return operation; }, retry: async () => { calls.push('retry'); return operation; },
    prepareReconfirmation: async () => { calls.push('reconfirmation-plan'); return { ...plan, operationId: operation.id, supersedes: operation.confirmationDigest, digest: 'c'.repeat(64) }; },
    reconfirm: async (_id, input) => { calls.push('reconfirm'); sent.push(structuredClone(input)); return { ...operation, confirmationDigest: 'c'.repeat(64) }; },
  };
  const store = { read: (id: string) => retained.get(id), write: (id: string, request: PendingDeletionRequest | undefined) => {
    if (request) retained.set(id, structuredClone(request)); else retained.delete(id);
  } };
  const session = () => new ProjectDeletionSession(deletionProjectId, api, store, { now: () => now });
  return { api, calls, sent, retained, plan, operation, store, session, elapse: (ms: number) => { now += ms; }, now: () => now,
    found: (value?: ProjectDeletionOperation) => { found = value; } };
}

test('打开先查询原操作；已有操作不创建新计划，轮询只读且同一次读取不会重入', async () => {
  const f = fixture(), session = f.session(); await session.open(); expect(f.calls).toEqual(['find', 'prepare']);
  expect(session.getSnapshot().plan).toEqual(f.plan); expect(f.sent).toHaveLength(0);
  f.found(f.operation); const reopened = f.session(); await reopened.open(); expect(reopened.getSnapshot().operation).toEqual(f.operation);
  expect(f.calls).toEqual(['find', 'prepare', 'find']);
  let finish!: (value: ProjectDeletionOperation) => void;
  f.api.find = async () => { f.calls.push('held-find'); return new Promise((resolve) => { finish = resolve; }); };
  const first = reopened.refresh(); await reopened.refresh(); expect(f.calls.at(-1)).toBe('held-find');
  finish(f.operation); await first; expect(f.calls.filter((call) => call === 'held-find')).toHaveLength(1);
});

test('先持久保留原确认，再发唯一 UUIDv7 请求；重复确认不能产生另一个请求键', async () => {
  const f = fixture(), session = f.session(); await session.open(); let finish!: () => void;
  f.api.accept = async (_id, input) => {
    f.sent.push(structuredClone(input)); expect(f.retained.get(deletionProjectId)?.input).toEqual(input);
    await new Promise<void>((resolve) => { finish = resolve; }); return f.operation;
  };
  const first = session.confirm(f.plan); await session.confirm(f.plan); expect(f.sent).toHaveLength(1);
  expect(AcceptProjectDeletionSchema.parse(f.sent[0])).toEqual(f.sent[0]!);
  finish(); await first; expect(session.getSnapshot()).toMatchObject({ pending: false, loading: false, operation: f.operation });
  expect(f.retained.size).toBe(0);
});

test('失回执后重开仍保留同一请求，过期计划不阻止核对；空查询不会被解释为未受理', async () => {
  const f = fixture(), first = f.session(); await first.open();
  f.api.accept = async (_id, input) => { f.sent.push(structuredClone(input)); throw new Error('private transport failure'); };
  await first.confirm(f.plan); const retained = structuredClone(f.retained.get(deletionProjectId));
  expect(first.getSnapshot()).toMatchObject({ pending: true, error: 'request-unknown', plan: undefined });
  f.plan.expiresAt = '2020-01-01T00:00:00.000Z'; const reopened = f.session(); await reopened.open(); await reopened.review(); await reopened.confirm(f.plan); await reopened.refresh();
  expect(f.calls.filter((call) => call === 'prepare')).toHaveLength(1); expect(reopened.getSnapshot().pending).toBe(true); expect(f.sent).toHaveLength(1);
  f.api.accept = async (_id, input) => { f.sent.push(structuredClone(input)); return f.operation; };
  await reopened.recover(); expect(f.sent).toEqual([retained!.input, retained!.input]);
  expect(reopened.getSnapshot().operation).toEqual(f.operation); expect(f.retained.size).toBe(0);
});

test('核对到已受理或最终回执就停止重发，关闭前请求的迟到回执仍归原项目', async () => {
  const f = fixture(), session = f.session(); await session.open(); let finish!: (value: ProjectDeletionOperation) => void;
  f.api.accept = async (_id, input) => { f.sent.push(input); return new Promise((resolve) => { finish = resolve; }); };
  const first = session.confirm(f.plan), reopened = f.session(); f.found(deletionOperation('succeeded')); await reopened.open(); await reopened.recover();
  expect(reopened.getSnapshot().operation?.state).toBe('succeeded'); expect(f.sent).toHaveLength(1);
  finish(f.operation); await first; expect(session.getSnapshot().operation?.project.id).toBe(ProjectIdSchema.parse(deletionProjectId));
  const otherId = '01a0f30b-c652-7000-8d6f-553e3b5f6140';
  const other = new ProjectDeletionSession(otherId, f.api, f.store); await other.open();
  expect(other.getSnapshot().error).toBe('read-failed'); expect(other.getSnapshot().operation).toBeUndefined();
});

test('旧计划、过期计划、无法保留请求及损坏缓存均拒绝写入；读取失败不回退为新计划', async () => {
  const f = fixture(), session = f.session(); await session.open();
  for (const wrong of [{ ...f.plan, digest: 'd'.repeat(64) }, { ...f.plan, id: f.operation.id }]) await session.confirm(wrong);
  expect(f.sent).toHaveLength(0);
  f.elapse(60_001); await session.confirm(f.plan); expect(f.sent).toHaveLength(0);
  f.plan.expiresAt = new Date(f.now() + 60_000).toISOString(); await session.review(); f.store.write = () => { throw new Error('private quota failure'); };
  await session.confirm(f.plan); expect(session.getSnapshot().error).toBe('cannot-retain-request'); expect(f.sent).toHaveLength(0);
  const bad = new ProjectDeletionSession(deletionProjectId, f.api, { read: () => ({ projectId: deletionProjectId, input: { requestKey: 'broken' }, digest: 'secret' }), write: f.store.write });
  await bad.open(); await bad.review(); await bad.recover(); expect(bad.getSnapshot().error).toBe('invalid-retained-request'); expect(f.sent).toHaveLength(0);
  f.api.find = async () => { throw new Error('private reader failure'); }; const offline = f.session(); await offline.open();
  expect(offline.getSnapshot().error).toBe('read-failed'); expect(offline.getSnapshot().plan).toBeUndefined();
});

test('重新确认固定原操作；未知回执看到旧摘要时只读等待，显式核对仍重放同一个确认', async () => {
  const f = fixture(); f.found(deletionOperation('needs-attention')); const session = f.session(); await session.open(); await session.review();
  const plan = session.getSnapshot().plan!; expect(plan.operationId).toBe(f.operation.id); expect(plan.supersedes).toBe(f.operation.confirmationDigest);
  f.api.reconfirm = async (_id, input) => { f.sent.push(structuredClone(input)); throw new Error('lost response'); };
  await session.confirm(plan); const input = f.sent[0]!; await session.refresh(); expect(session.getSnapshot().pending).toBe(true); expect(f.sent).toHaveLength(1);
  f.api.reconfirm = async (_id, request) => { f.sent.push(structuredClone(request)); return { ...f.operation, confirmationDigest: plan.digest }; };
  const reopened = f.session(); await reopened.open(); expect(reopened.getSnapshot().pending).toBe(true); await reopened.recover();
  expect(f.sent).toEqual([input, input]); expect(reopened.getSnapshot().pending).toBe(false);
});
test('旧窗口的迟到首次回执不能清掉新窗口正在核对的重新确认请求', async () => {
  const f = fixture(), first = f.session(); await first.open(); let finish!: (value: ProjectDeletionOperation) => void;
  f.api.accept = async (_id, input) => { f.sent.push(structuredClone(input)); return new Promise((resolve) => { finish = resolve; }); };
  const initial = first.confirm(f.plan); f.found(deletionOperation('needs-attention'));
  const newer = f.session(); await newer.open(); await newer.review();
  f.api.reconfirm = async (_id, input) => { f.sent.push(structuredClone(input)); throw new Error('lost newer receipt'); };
  await newer.confirm(newer.getSnapshot().plan!); const pending = structuredClone(f.retained.get(deletionProjectId));
  finish(f.operation); await initial; expect(f.retained.get(deletionProjectId)).toEqual(pending);
  expect(newer.getSnapshot().pending).toBe(true); expect(f.sent[0]!.requestKey).not.toBe(f.sent[1]!.requestKey);
});

test('合法形状但不属于原确认的写响应仍保留未知请求，不能用它报告已受理', async () => {
  const f = fixture(), session = f.session(); await session.open();
  f.api.accept = async (_id, input) => { f.sent.push(input); return { ...f.operation, confirmationDigest: 'd'.repeat(64) }; };
  await session.confirm(f.plan); expect(session.getSnapshot()).toMatchObject({ pending: true, error: 'request-unknown' });
  expect(session.getSnapshot().operation).toBeUndefined(); expect(f.retained.size).toBe(1);
  f.found(f.operation); await session.recover(); expect(session.getSnapshot().operation).toEqual(f.operation); expect(f.sent).toHaveLength(1);
});

test('换操作或错误重新确认计划不会提交；阻塞且可继续的原操作才允许 retry', async () => {
  const f = fixture(); f.found(deletionOperation('needs-attention')); const session = f.session(); await session.open();
  for (const wrong of [f.plan, { ...f.plan, operationId: f.operation.id, supersedes: 'd'.repeat(64) }]) {
    f.api.prepareReconfirmation = async () => wrong as ProjectDeletionPlan; await session.review(); expect(session.getSnapshot().plan).toBeUndefined();
  }
  expect(f.sent).toHaveLength(0); await session.retry(); expect(f.calls.at(-1)).toBe('retry');
  await session.retry(); expect(f.calls.filter((call) => call === 'retry')).toHaveLength(1);
  f.found(ProjectDeletionOperationSchema.parse({ ...f.operation, id: '01a0f30b-c652-7000-8d6f-553e3b5f6140' })); await session.refresh();
  expect(session.getSnapshot().operation?.id).toBe(f.operation.id); expect(session.getSnapshot().error).toBe('read-failed');
});
