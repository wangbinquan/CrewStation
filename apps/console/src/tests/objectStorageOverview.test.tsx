import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { ObjectBackendDtoSchema, ObjectSpaceDtoSchema } from '@crewstation/contracts';
import { adminDirectoryFixture } from './adminDirectoryFixture';
import { renderApp } from './renderApp';

const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; sessionStorage.clear(); });
function fixture() {
  adminDirectoryFixture({ count: 0 });
  const fallback = globalThis.fetch, id = Bun.randomUUIDv7(), at = new Date().toISOString();
  const backend = ObjectBackendDtoSchema.parse({ id, name: 'Local Garage', endpoint: 'http://garage:3900', region: 'garage', bucket: 'crewstation',
    revision: 1, placementRevision: 1, credentialRevision: 1, state: 'active', health: 'ready', durability: 'dev-only', durabilityVerifiedAt: null,
    budgetBytes: 60 * 1024 ** 3, reservedBytes: 0, physicalFreeBytes: null, physicalTotalBytes: null, observedAt: at, message: null, createdAt: at });
  const spaces = ['production', 'development'].map((env, i) => ObjectSpaceDtoSchema.parse({ id: Bun.randomUUIDv7(), projectId: Bun.randomUUIDv7(), serviceId: Bun.randomUUIDv7(),
    env, backendId: id, backendPlacementRevision: 1, planId: Bun.randomUUIDv7(), planRevision: 1, revision: 1, health: 'ready', quotaBytes: (i + 1) * 1024 ** 3,
    usedBytes: (i + 1) * 1024, reservedBytes: 512, deletingBytes: (i + 1) * 10, objectCount: 1, createdAt: at }));
  const state = { backends: [backend], spaces, backendError: false, spacesError: false, invalid: false, hold: undefined as Promise<void> | undefined };
  const calls: { url: URL; method: string }[] = [];
  globalThis.fetch = (async (raw, init) => {
    const url = new URL(String(raw), 'http://localhost');
    if (!url.pathname.startsWith('/v3/admin/object-storage/')) return fallback(raw, init);
    calls.push({ url, method: init?.method ?? 'GET' });
    const backends = url.pathname.endsWith('/backends');
    if (!backends && !url.pathname.endsWith('/spaces')) return Response.json({ items: [] });
    if (state.hold) await state.hold;
    if (backends ? state.backendError : state.spacesError) return Response.json({ error: 'unavailable', message: '存储目录暂时不可用' }, { status: 503 });
    return Response.json({ items: backends ? state.invalid ? [{}] : state.backends : state.spaces });
  }) as typeof fetch;
  return { state, backend, calls };
}
function card() { return [...document.querySelectorAll('main h2')].find((h) => h.textContent === '对象存储状态')!.closest('section')!; }
function values() { return Object.fromEntries([...card().querySelectorAll('dl > div')].map((row) => [row.querySelector('dt')!.textContent, row.querySelector('dd')!.textContent])); }

test('overview storage card precedes todos, aggregates both environments without adding backend budgets and opens the management route', async () => {
  const f = fixture(); page = await renderApp('/admin');
  const cluster = [...document.querySelectorAll('main h2')].find((h) => h.textContent === '集群状态')!.closest('section')!;
  const todo = document.querySelector('#admin-todo-title')!.closest('section')!;
  expect(cluster.compareDocumentPosition(card()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(card().compareDocumentPosition(todo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(values()).toEqual({ 存储后端: '就绪 1 / 1', 对象空间: '2', 逻辑已用: '3 KiB', 空间配额合计: '3 GiB', 上传预留: '1 KiB', 待删除: '30 B' });
  expect(card().textContent).toContain('空间配额不代表磁盘容量');
  expect(f.calls.map((c) => c.url.pathname).sort()).toEqual(['/v3/admin/object-storage/backends', '/v3/admin/object-storage/spaces']);
  expect(f.calls.every((c) => c.method === 'GET' && c.url.search === '')).toBe(true);
  expect(document.querySelectorAll('#admin-entries-observability + div a[href="/admin/object-storage"]')).toHaveLength(1);
  await page.click('管理对象存储'); expect(page.path()).toBe('/admin/object-storage');
});

test('loading is unknown; only successfully observed empty storage renders zero and not configured', async () => {
  const f = fixture(); let release = () => {}; f.state.hold = new Promise<void>((resolve) => { release = resolve; });
  page = await renderApp('/admin');
  expect(card().textContent).toContain('正在读取存储后端'); expect(card().textContent).toContain('正在读取对象空间');
  expect(Object.values(values()).every((v) => v === '—')).toBe(true);
  f.state.backends = []; f.state.spaces = [];
  await act(async () => release()); await page.settle();
  expect(card().textContent).toContain('未配置');
  expect(values()).toEqual({ 存储后端: '就绪 0 / 0', 对象空间: '0', 逻辑已用: '0 B', 空间配额合计: '0 B', 上传预留: '0 B', 待删除: '0 B' });
});

test('offline and degraded storage need attention; expired observations remain unknown', async () => {
  const f = fixture(); f.backend.state = 'offline'; page = await renderApp('/admin');
  expect(card().textContent).toContain('需要关注'); expect(values().存储后端).toBe('就绪 0 / 1');
  f.backend.state = 'active'; f.backend.health = 'degraded'; await page.reread(); expect(card().textContent).toContain('需要关注');
  f.backend.health = 'unknown'; await page.reread(); expect(card().textContent).toContain('待观测');
  f.backend.health = 'ready'; f.state.spaces[0]!.health = 'degraded'; await page.reread();
  expect(values().存储后端).toBe('就绪 1 / 1'); expect(card().textContent).toContain('需要关注');
});

test('a failed refresh hides old counts only for the failed source and recovers on the next read', async () => {
  const f = fixture(); page = await renderApp('/admin'); f.state.spacesError = true; await page.reread();
  expect(card().textContent).toContain('对象空间读取失败'); expect(card().textContent).toContain('待观测');
  expect(values()).toMatchObject({ 存储后端: '就绪 1 / 1', 对象空间: '—', 逻辑已用: '—', 空间配额合计: '—' });
  f.state.spacesError = false; f.state.backendError = true; await page.reread();
  expect(card().textContent).toContain('存储后端读取失败'); expect(values()).toMatchObject({ 存储后端: '—', 对象空间: '2', 逻辑已用: '3 KiB' });
  f.state.backendError = false; await page.reread(); expect(values().存储后端).toBe('就绪 1 / 1'); expect(card().querySelector('[role="alert"]')).toBeNull();
});

test('malformed storage responses remain a local error without breaking the overview', async () => {
  const f = fixture(); f.state.invalid = true; page = await renderApp('/admin');
  expect(card().textContent).toContain('对象存储回执不完整'); expect(values().存储后端).toBe('—');
  expect(document.querySelector('#admin-todo-title')).not.toBeNull(); expect(values().对象空间).toBe('2');
});
