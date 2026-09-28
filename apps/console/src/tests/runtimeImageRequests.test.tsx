import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { AdminRuntimeImagesPage } from '../features/runtime-images';
import { messages } from '../features/runtime-images/i18n/zh-CN';
import { renderElement } from './renderElement';
import { riId, runtimeImageConsoleFixture } from './runtimeImageConsoleFixture';
let page: Awaited<ReturnType<typeof renderElement>> | undefined, fixture: ReturnType<typeof runtimeImageConsoleFixture> | undefined;
afterEach(() => { page?.unmount(); fixture?.restore(); page = undefined; fixture = undefined; });

test('满页 30 个镜像首屏与自动重读各只读取一次目录，不逐行放大为 90 个请求', async () => {
  fixture = runtimeImageConsoleFixture(true);
  const original = globalThis.fetch, calls: string[] = [];
  globalThis.fetch = (async (raw, init) => {
    const path = new URL(String(raw), 'http://test').pathname; calls.push(path);
    if (path === '/v1/admin/runtime-image-catalog') return Response.json({ items: Array.from({ length: 30 }, (_, index) => ({ ...fixture!.image, id: riId(100 + index), name: `Tools ${index}`, summary: {
      version: index === 29 ? null : { id: riId(200 + index), digest: `sha256:${'a'.repeat(64)}`, architecture: 'linux/amd64', state: 'available' },
      build: index === 29 ? null : { id: riId(300 + index), state: 'failed', updatedAt: '2026-09-28T00:00:00Z', error: 'install failed' },
      validation: index === 29 ? null : { id: riId(400 + index), state: 'passed', usage: 'task' },
    } })) });
    return original(raw, init);
  }) as typeof fetch;
  page = await renderElement(<AdminRuntimeImagesPage />, messages);
  // Regression: an ordinary full page used to send 90 extra requests into a burst-40 gateway.
  expect(page.host.querySelectorAll('tbody tr')).toHaveLength(30);
  expect(calls.filter((path) => path.startsWith('/v1/admin/runtime-image-catalog/'))).toEqual([]);
  expect(page.text()).toContain('install failed'); expect(page.text()).toContain('验证通过'); expect(page.text()).toContain('尚无构建产物');
  const count = () => calls.filter((path) => path === '/v1/admin/runtime-image-catalog').length;
  expect(count()).toBe(1); await page.reread(); expect(count()).toBe(2);
  expect(calls.filter((path) => path.startsWith('/v1/admin/runtime-image-catalog/'))).toEqual([]);
});
