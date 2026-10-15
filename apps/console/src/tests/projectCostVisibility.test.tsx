// RFC-034 v2 §3.4：项目费用可见性默认不可见；管理员在价格配置页按项目开关（PUT { visible }），只读一项、不批量读。
import './domSetup';
import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { SetProjectCostVisibility } from '@crewstation/contracts';
import { RUNTIME_IMAGES } from './computeProfileFixture';
import { adminDirectoryFixture } from './adminDirectoryFixture';
import { openDialog } from './confirmDialogDriver';
import { renderApp } from './renderApp';

let page: Awaited<ReturnType<typeof renderApp>> | undefined;
const originalFetch = globalThis.fetch;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });
function backend() {
  const directory = adminDirectoryFixture({ count: 75 }), delegate = globalThis.fetch;
  const state = { readError: false }, values = new Map<string, { visible: boolean; updatedAt: string }>();
  const writes: Array<{ id: string; input: SetProjectCostVisibility }> = [], reads: string[] = [];
  globalThis.fetch = (async (raw: RequestInfo | URL, options?: RequestInit) => {
    const url = new URL(String(raw), 'http://localhost'), match = /^\/v1\/admin\/observability\/projects\/([^/]+)\/cost-visibility$/.exec(url.pathname);
    if (url.pathname === '/v1/admin/runtime-images') return Response.json(RUNTIME_IMAGES);
    if (url.pathname === '/v1/admin/observability/pricing') return Response.json({ profiles: [] });
    if (!match) return delegate(raw, options);
    const id = decodeURIComponent(match[1]!);
    if (options?.method !== 'PUT') {
      reads.push(id);
      if (state.readError) return Response.json({ error: 'unavailable', message: '可见性读取暂时失败', details: {} }, { status: 503 });
      const value = values.get(id);
      return Response.json({ projectId: id, visible: value?.visible ?? false, updatedAt: value?.updatedAt ?? null });
    }
    const input = JSON.parse(String(options.body)) as SetProjectCostVisibility;
    writes.push({ id, input });
    const value = { visible: input.visible, updatedAt: new Date().toISOString() };
    values.set(id, value);
    return Response.json({ projectId: id, ...value });
  }) as typeof fetch;
  return { directory, state, writes, reads };
}
async function choose(value: string) {
  const select = openDialog().querySelector('select');
  if (!select) throw new Error('No visibility selector');
  await act(async () => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await page!.settle();
}
async function close() { await act(async () => openDialog().dispatchEvent(new Event('cancel', { cancelable: true }))); await page!.settle(); }
async function lastRow() {
  const button = [...openDialog().querySelectorAll('tbody button')].at(-1) as HTMLButtonElement | undefined;
  if (!button) throw new Error('No project row');
  button.focus(); await act(async () => button.click()); await page!.settle(); return button;
}
const submit = () => openDialog().querySelector<HTMLButtonElement>('button[type="submit"]')!;
async function openManager() { page = await renderApp('/admin/compute?tab=pricing'); await page.click('项目金额可见性'); }

describe('RFC-034 v2 project cost visibility', () => {
  test('a project starts hidden; opening it to members saves only that project and keeps the manager open', async () => {
    const b = backend(); await openManager();
    expect(b.reads).toEqual([]); expect(openDialog().querySelectorAll('tbody tr')).toHaveLength(20);
    const trigger = await lastRow();
    expect(b.reads).toHaveLength(1);
    expect(openDialog().querySelector('select')?.value).toBe('hidden'); expect(openDialog().textContent).toContain('尚未设置，按默认不可见。');
    expect(submit().disabled).toBe(true);
    await choose('visible'); expect(submit().disabled).toBe(false);
    await page!.click('保存可见性');
    expect(b.writes).toEqual([{ id: b.reads[0]!, input: { visible: true } }]);
    expect(openDialog().querySelector('h2')?.textContent).toBe('项目金额可见性');
    await act(async () => trigger.click()); await page!.settle();
    expect(openDialog().querySelector('select')?.value).toBe('visible'); expect(openDialog().textContent).toContain('最近修改于');
    expect(b.directory.writes()).toEqual([]);
  });

  test('a closed editor keeps its draft; switching projects with a draft asks first', async () => {
    const b = backend(); await openManager();
    await lastRow(); await choose('visible'); await close();
    await lastRow(); expect(openDialog().querySelector('select')?.value).toBe('visible'); await close();
    const first = openDialog().querySelector<HTMLButtonElement>('tbody button')!;
    await act(async () => first.click()); await page!.settle();
    expect(openDialog().getAttribute('role')).toBe('alertdialog');
    await close();
    expect(openDialog().querySelector('select')?.value).toBe('visible'); expect(b.writes).toEqual([]);
  });

  test('an unavailable setting stays read-only until a valid response arrives', async () => {
    const b = backend(); b.state.readError = true; await openManager(); await lastRow();
    expect(openDialog().textContent).toContain('可见性读取暂时失败');
    expect(submit().disabled).toBe(true); expect(openDialog().querySelector('select')).toBeNull();
    b.state.readError = false; await page!.reread();
    expect(openDialog().querySelector('select')?.value).toBe('hidden'); expect(b.writes).toEqual([]);
  });
});
