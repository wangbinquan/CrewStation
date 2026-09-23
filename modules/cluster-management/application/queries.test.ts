import { expect, test } from 'bun:test';
import type { ClusterDeps } from './dependencies';
import { readSnapshot } from './queries';

// 2026-09-23 裁定：工作台不再有刷新按钮，读取失败由页面自动重读；接口文案只陈述事实，不叫人手动刷新。
test('no snapshot yet: asks the collector to run and reports the first collection as not finished', async () => {
  let requested = 0;
  const repository = { latest: async () => undefined, snapshot: async () => undefined, requestRefresh: async () => { requested += 1; return 'refresh-1'; } };
  const deps = { repository, clock: { now: () => new Date('2026-09-23T00:00:00Z') } } as unknown as ClusterDeps;
  const failure = await readSnapshot(deps).catch((error: unknown) => error);
  expect(failure).toMatchObject({ kind: 'unavailable', message: '首次采集尚未完成' });
  expect(String((failure as Error).message)).not.toContain('刷新');
  expect(requested).toBe(1);
  // 指定的快照不存在是过期（410），不触发采集。
  await expect(readSnapshot(deps, 'snapshot-gone')).rejects.toMatchObject({ kind: 'not_found', details: { status: 410 } });
  expect(requested).toBe(1);
});
