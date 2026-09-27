import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { BusinessSubtaskV3Dto } from '@crewstation/contracts';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { businessTaskMigrations } from '../wiring';
import { agentRuntimeImageFixture } from './agentRuntimeImageFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-028 业务 Agent 独立镜像', () => {
  let tdb: TestDatabase;
  beforeAll(async () => { tdb = await createTestDatabase([businessTaskMigrations]); });
  afterAll(async () => { await tdb?.drop(); });
  test('并发同键只保留胜出的 Agent 镜像引用', async () => {
    const f = await agentRuntimeImageFixture(tdb.db), reserve = f.port.reserveAgent!, released: string[] = [];
    let open!: () => void; const gate = new Promise<void>((resolve) => { open = resolve; });
    f.port.reserveAgent = async (...args) => { const snapshot = await reserve(...args); if (f.reservations.length === 3) open(); await gate; return snapshot; };
    f.port.release = async (_snapshot, owner) => { released.push(owner.id); };
    const responses = await Promise.all(Array.from({ length: 3 }, () => f.request(f.path, f.input)));
    expect(responses.every((r) => r.status < 300)).toBe(true);
    const views = await Promise.all(responses.map((r) => r.json() as Promise<BusinessSubtaskV3Dto>));
    expect(new Set(views.map((view) => view.id)).size).toBe(1);
    expect(new Set(released)).toEqual(new Set(f.reservations.map((entry) => entry[1]).filter((id) => id !== f.inputs[0]!.id)));
    expect(released).toHaveLength(2);
  });
  test('请求覆盖、档案默认和平台默认各自固定，不能借父任务或其他 Agent 的允许集合', async () => {
    const f = await agentRuntimeImageFixture(tdb.db), body = { ...f.input, runtimeImageVersionId: f.explicitVersion };
    const response = await f.request(f.path, body); expect(response.status).toBe(202);
    const view = await response.json() as BusinessSubtaskV3Dto;
    expect(view.runtimeImage).toMatchObject({ versionId: f.explicitVersion, selectionSource: 'request' });
    expect(f.inputs[0]!.runtimeImage).toEqual(view.runtimeImage);
    expect(view.image).toBe(f.inputs[0]!.image);
    expect(f.reservations[0]!.slice(3)).toEqual([{ profileId: f.computeId, revision: 3 }, f.explicitVersion]);
    expect(f.order).toEqual([`confirm:${f.inputs[0]!.id}`, `create:${f.inputs[0]!.id}`]);
    expect((await f.make().request(f.path, body)).status).toBe(202); expect(f.reservations).toHaveLength(1);
    expect((await f.request(f.path, { ...body, runtimeImageVersionId: f.defaultVersion })).status).toBe(409);
    for (const version of [f.parentVersion, f.otherVersion]) expect((await f.request(f.path, { ...body, requestKey: version, runtimeImageVersionId: version })).status).toBe(412);
    expect(f.inputs).toHaveLength(1);
    expect(await (await f.request(f.path, { ...f.input, requestKey: 'default' })).json()).toMatchObject({ runtimeImage: { versionId: f.defaultVersion, selectionSource: 'configuration' } });
    const fallback = await f.request(f.path, { ...f.input, requestKey: 'platform', agentProfileId: f.profiles[2]!.id });
    expect(fallback.status).toBe(202); expect((await fallback.json()).runtimeImage).toBeUndefined();
    expect(f.inputs.at(-1)!.runtimeImage).toBeUndefined(); expect(f.inputs.at(-1)!.image).toContain('/platform@');
  });
  test('429 同键重试保留已受理镜像与独立容器 ID，不重新解析变化的默认', async () => {
    const f = await agentRuntimeImageFixture(tdb.db); f.state.quota = true;
    expect((await f.request(f.path, f.input)).status).toBe(429);
    const first = f.inputs[0]!; f.state.quota = false;
    f.port.reserveAgent = async () => { throw new Error('must not re-resolve'); };
    expect((await f.make().request(f.path, f.input)).status).toBe(202);
    expect(f.inputs.at(-1)!.id).toBe(first.id); expect(f.inputs.at(-1)!.runtimeImage).toEqual(first.runtimeImage);
  });
  test('镜像端口或确认缺失明确失败，不创建回退环境', async () => {
    const f = await agentRuntimeImageFixture(tdb.db); f.port.reserveAgent = undefined;
    expect((await f.request(f.path, f.input)).status).toBe(412); expect(f.inputs).toHaveLength(0);
    const second = await agentRuntimeImageFixture(tdb.db); second.port.confirmAgent = undefined;
    const response = await second.request(second.path, second.input);
    expect(await response.json()).toMatchObject({ state: 'failed', error: { code: 'unsupported_capability' } });
    expect(second.inputs).toHaveLength(0);
  });
});
