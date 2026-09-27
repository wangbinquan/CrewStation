import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { newResourceId, precondition } from '@crewstation/kernel';
import { businessTaskMigrations } from '../wiring';
import { agentImageResumeFixture } from './agentImageResumeFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-028 Agent resume 保留镜像引用', () => {
  let db: TestDatabase;
  beforeEach(async () => { db = await createTestDatabase([businessTaskMigrations]); });
  afterEach(async () => { await db?.drop(); });
  test('已停用版本可沿原引用恢复，不重选或刷新初始化 Secret 快照', async () => {
    const f = await agentImageResumeFixture(db.db), restored: unknown[] = [];
    f.port.reserveAgent = async () => { throw precondition('已停用，不能新准入'); };
    f.port.restoreAgent = async (...args) => { restored.push(args); };
    // 原实现调用 reserveAgent，停用后这里返回 412，并可能取到更新后的 Secret 版本。
    const response = await f.request(f.path, f.resume); expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ runtimeImage: f.view.runtimeImage, image: f.view.image });
    expect(restored).toEqual([[f.projectId, f.view.runtimeImage, f.env.id, f.inputs[1]!.id]]);
    expect(f.inputs[1]!.runtimeImage).toEqual(f.view.runtimeImage);
    expect((await f.request(f.path, f.resume)).status).toBe(202); expect(restored).toHaveLength(1);
  });
  test('恢复不能改镜像，缺失原引用或恢复端口时不创建容器', async () => {
    const f = await agentImageResumeFixture(db.db);
    expect((await f.request(f.path, { ...f.resume, runtimeImageVersionId: newResourceId() })).status).toBe(409);
    expect((await f.request(f.path, f.resume)).status).toBe(412);
    f.port.restoreAgent = async () => { throw precondition('原镜像引用缺失'); };
    expect((await f.request(f.path, f.resume)).status).toBe(412);
    expect(f.inputs).toHaveLength(1);
  });
  test('fresh 重试复制停用镜像的原快照，只创建新执行与会话目录', async () => {
    const f = await agentImageResumeFixture(db.db), restored: unknown[] = [];
    f.port.reserveAgent = async () => { throw precondition('已停用，不能新准入'); };
    f.port.restoreAgent = async (...args) => { restored.push(args); };
    const path = `${f.path}/${f.view.id}/retry`, input = { requestKey: 'fresh-image', expectedAttempt: 1, resumePolicy: 'fresh', fence: f.input.fence };
    const response = await f.request(path, input); expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ attempt: 2, previousId: f.view.id, runtimeImage: f.view.runtimeImage, image: f.view.image, profileRevision: f.view.profileRevision });
    expect(f.inputs[1]!.runtimeImage).toEqual(f.view.runtimeImage);
    expect(f.inputs[1]!.businessSession).toEqual({ key: f.inputs[1]!.id, mode: 'create' });
    expect(restored).toEqual([[f.projectId, f.view.runtimeImage, f.env.id, f.inputs[1]!.id]]);
    expect((await f.request(path, input)).status).toBe(202); expect(restored).toHaveLength(1);
  });
  test('fresh 重试缺失原引用时拒绝，不能通过重新选择默认绕过', async () => {
    const f = await agentImageResumeFixture(db.db);
    f.port.restoreAgent = async () => { throw precondition('原镜像引用缺失'); };
    expect((await f.request(`${f.path}/${f.view.id}/retry`, { requestKey: 'missing-reference', expectedAttempt: 1, resumePolicy: 'fresh', fence: f.input.fence })).status).toBe(412);
    expect(f.inputs).toHaveLength(1);
  });
  test('并发 fresh 重试只保留一个后继的镜像引用', async () => {
    const f = await agentImageResumeFixture(db.db), copied: string[] = [], released: string[] = [];
    let open!: () => void; const gate = new Promise<void>((resolve) => { open = resolve; });
    f.port.restoreAgent = async (_project, _snapshot, _from, to) => { copied.push(to); if (copied.length === 3) open(); await gate; };
    f.port.release = async (_snapshot, owner) => { released.push(owner.id); };
    const input = { requestKey: 'concurrent-fresh', expectedAttempt: 1, resumePolicy: 'fresh', fence: f.input.fence };
    const responses = await Promise.all(Array.from({ length: 3 }, () => f.request(`${f.path}/${f.view.id}/retry`, input)));
    expect(responses.every((r) => r.status < 300)).toBe(true);
    expect(new Set(released)).toEqual(new Set(copied.filter((id) => id !== f.inputs[1]!.id)));
    expect(released).toHaveLength(2);
  });
});
