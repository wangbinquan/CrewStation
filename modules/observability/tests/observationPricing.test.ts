// RFC-034 v2 §3.3–§3.4：价格目录（档位 × 配置模型与实际出现过的模型、按需出现的协议内置价格线）、只追加的价格版本
// 以 expectedLatestId 比较并设置、项目费用可见性默认不可见；读写都仅管理员。真实 PostgreSQL。
import { afterEach, describe, expect, test } from 'bun:test';
import type { SaveObservationPriceInput } from '@crewstation/contracts';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { ADMIN, MEMBER, PROFILE, PROJECT_A, agentCallFixture, dropFixtures, minutes, snapshot, start } from './agentCallFixture';

const available = await testDatabaseAvailable();
afterEach(dropFixtures);
const price = (model: string, input: string | null, expectedLatestId: string | null): SaveObservationPriceInput =>
  ({ model, rates: { input, cacheRead: null, cacheWrite: null, output: '8' }, effectiveFrom: minutes(0).toISOString(), note: 'list price', expectedLatestId });

describe.skipIf(!available)('RFC-034 v2 observation pricing', () => {
  test('the directory lists configured models, models seen in runs and built-in lines only once they are used', async () => {
    const f = await agentCallFixture();
    expect((await f.api.pricing(ADMIN)).profiles).toEqual([{ profileId: PROFILE, name: 'GLM 档位', protocol: 'opencode', builtin: false, configuredModel: 'zhipu/glm-5',
      models: [{ model: 'zhipu/glm-5', calls: 0, current: null }] }]);
    const seen = start({ taskId: 'task-seen' }), test = start({ projectId: null, source: 'platform', kind: 'profile-test', taskId: 'test-1', subtaskId: null, attempt: null, profile: null, protocol: 'claude-code' });
    for (const call of [seen, test]) await f.recorder.accept(call);
    await f.recorder.finish(seen, { status: 'done', at: minutes(1), snapshot: snapshot('complete', [{ model: 'zhipu/glm-5', input: 1 }, { model: 'deepseek/v3', input: 2 }]) });
    await f.recorder.finish(test, { status: 'done', at: minutes(1), snapshot: snapshot('complete', [{ model: 'claude-sonnet', input: 3 }]) });
    const profiles = (await f.api.pricing(ADMIN)).profiles;
    expect(profiles.map((profile) => [profile.profileId, profile.builtin, profile.models.map((line) => [line.model, line.calls])])).toEqual([
      [PROFILE, false, [['deepseek/v3', 1], ['zhipu/glm-5', 1]]], ['builtin:claude-code', true, [['claude-sonnet', 1]]],
    ]);
  });

  test('versions append with compare-and-set; history is newest first and the directory shows the current one', async () => {
    const f = await agentCallFixture();
    const first = await f.api.savePrice(ADMIN, PROFILE, price('zhipu/glm-5', '2', null));
    expect(first).toMatchObject({ profileId: PROFILE, model: 'zhipu/glm-5', rates: { input: '2', cacheRead: null, cacheWrite: null, output: '8' }, createdBy: ADMIN.userId, note: 'list price' });
    await expect(f.api.savePrice(ADMIN, PROFILE, price('zhipu/glm-5', '3', null))).rejects.toMatchObject({ kind: 'conflict', details: { code: 'price_conflict' } });
    const second = await f.api.savePrice(ADMIN, PROFILE, price('zhipu/glm-5', '0', first.id));
    expect((await f.api.priceHistory(ADMIN, PROFILE, 'zhipu/glm-5')).items.map((row) => [row.id, row.rates.input])).toEqual([[second.id, '0'], [first.id, '2']]);
    expect((await f.api.pricing(ADMIN)).profiles[0]!.models).toEqual([{ model: 'zhipu/glm-5', calls: 0, current: second }]);
    await f.api.savePrice(ADMIN, 'builtin:opencode', price('kimi/k2', null, null));
    await expect(f.api.savePrice(ADMIN, 'builtin:unknown', price('m', '1', null))).rejects.toMatchObject({ kind: 'not_found' });
    await expect(f.api.savePrice(ADMIN, '01a0bf5d-8f4b-7e09-82e1-9a99060b1192', price('m', '1', null))).rejects.toMatchObject({ kind: 'not_found' });
  });

  test('project cost visibility defaults to hidden and is set per project', async () => {
    const f = await agentCallFixture();
    expect(await f.api.costVisibility(ADMIN, PROJECT_A)).toEqual({ projectId: PROJECT_A, visible: false, updatedAt: null });
    expect(await f.api.setCostVisibility(ADMIN, PROJECT_A, { visible: true })).toMatchObject({ projectId: PROJECT_A, visible: true });
    expect((await f.api.costVisibility(ADMIN, PROJECT_A)).visible).toBe(true);
    await f.api.setCostVisibility(ADMIN, PROJECT_A, { visible: false });
    expect((await f.api.costVisibility(ADMIN, PROJECT_A)).visible).toBe(false);
  });

  test('pricing and visibility are system-administrator only', async () => {
    const f = await agentCallFixture();
    for (const denied of [f.api.pricing(MEMBER), f.api.priceHistory(MEMBER, PROFILE, 'm'), f.api.savePrice(MEMBER, PROFILE, price('m', '1', null)),
      f.api.costVisibility(MEMBER, PROJECT_A), f.api.setCostVisibility(MEMBER, PROJECT_A, { visible: true })]) await expect(denied).rejects.toMatchObject({ kind: 'forbidden' });
    expect((await f.api.priceHistory(ADMIN, PROFILE, 'm')).items).toEqual([]);
  });
});
