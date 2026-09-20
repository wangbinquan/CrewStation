import { expect, test } from 'bun:test';
import { ResourceIdSchema } from '@crewstation/contracts';
import { newDraftResourceId } from './resourceId';

test('浏览器草稿资源使用完整 UUIDv7，包含生成时间且不会因同名碰撞', () => {
  const before = Date.now(), ids = Array.from({ length: 100 }, newDraftResourceId), after = Date.now();
  expect(new Set(ids).size).toBe(100);
  for (const id of ids) {
    expect(ResourceIdSchema.safeParse(id).success).toBe(true);
    const timestamp = Number.parseInt(id.replace(/-/g, '').slice(0, 12), 16);
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
  }
});
