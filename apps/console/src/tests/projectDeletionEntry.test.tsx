import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { renderApp } from './renderApp';
import { adminDirectoryFixture } from './adminDirectoryFixture';
import { deletionOperation, deletionPlan } from './projectDeletionFixture';
import { dialogConfirmButton, openDialog, typeConfirmWord } from './confirmDialogDriver';

const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; sessionStorage.clear(); });
function fixture() {
  const directory = adminDirectoryFixture({ count: 180 }), fallback = globalThis.fetch;
  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  const state = { available: false, failure: false };
  globalThis.fetch = (async (raw, init) => {
    const path = new URL(String(raw), 'http://localhost').pathname, method = init?.method ?? 'GET';
    if (path === '/v1/project-deletions/capabilities') {
      calls.push({ path, method, body: undefined });
      return state.failure ? Response.json({ error: 'unavailable', message: 'Capability offline', details: {} }, { status: 503 }) : Response.json({ available: state.available });
    }
    const match = /^\/v1\/projects\/([0-9a-f-]+)\/(deletion-operation|deletion-plans|deletions)$/.exec(path);
    if (!match) return fallback(raw, init);
    calls.push({ path, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const project = directory.projects.find(row => row.project.id === match[1])!.project;
    if (match[2] === 'deletion-operation') return Response.json({ projectId: project.id, operation: null });
    if (match[2] === 'deletion-plans') return Response.json({ ...deletionPlan(), target: { ...deletionPlan().target, id: project.id, name: project.name, slug: project.slug, namespace: project.namespace, kind: project.kind, state: project.state, revision: '3' } });
    return Response.json({ ...deletionOperation(), project: { id: project.id, name: project.name, slug: project.slug } }, { status: 202 });
  }) as typeof fetch;
  return { ...directory, identity: directory.state, calls, state };
}

test.each(['/admin/projects', '/admin/integrations'])('%s last-row permanent deletion uses two modal layers and preserves the directory', async route => {
  const f = fixture(); page = await renderApp(`${route}?q=managed`);
  expect(page.text()).not.toContain('永久删除项目'); expect(f.calls.every(call => call.method === 'GET')).toBe(true);
  f.state.available = true; await page.reread(); await page.click('下一页');
  const main = document.querySelector('main')!, rows = document.querySelectorAll('tbody tr'), last = rows[rows.length - 1]!;
  main.scrollTop = 700;
  const trigger = [...last.querySelectorAll('button')].find(node => node.textContent === '永久删除项目')!;
  await act(async () => { trigger.focus(); trigger.click(); }); await page.settle();
  expect(openDialog().closest('table')).toBeNull(); expect(openDialog().textContent).toContain(last.querySelector('strong')!.textContent!);
  await page.click('继续删除…'); expect(document.querySelectorAll('dialog[open]')).toHaveLength(2);
  await typeConfirmWord('wrong'); expect(dialogConfirmButton().disabled).toBe(true);
  await act(async () => openDialog().dispatchEvent(new Event('cancel', { cancelable: true }))); await page.settle();
  expect(document.querySelectorAll('dialog[open]')).toHaveLength(1);
  expect(f.calls.filter(call => call.path.endsWith('/deletions'))).toHaveLength(0);
  await page.click('关闭'); expect(document.activeElement).toBe(trigger); expect(main.scrollTop).toBe(700);
  expect(page.search()).toMatchObject({ q: 'managed', cursor: '20' }); expect(document.querySelectorAll('tbody tr')).toHaveLength(20);
  await act(async () => trigger.click()); await page.settle(); await page.click('继续删除…');
  await typeConfirmWord('delete'); await page.click('永久删除项目');
  expect(f.calls.filter(call => call.path.endsWith('/deletions'))).toHaveLength(1); expect(page.text()).toContain('项目正在清理中');
  expect(page.text()).not.toContain('项目已彻底删除');
});

test('capability or current identity failure removes deletion actions; ordinary users never read the admin capability', async () => {
  const f = fixture(); f.state.available = true; page = await renderApp('/admin/projects');
  expect(page.text()).toContain('永久删除项目'); f.state.failure = true; await page.reread();
  expect(page.text()).not.toContain('永久删除项目'); expect(f.calls.every(call => call.method === 'GET')).toBe(true);
  f.state.failure = false; await page.reread(); expect(page.text()).toContain('永久删除项目');
  f.state.available = false; await page.reread(); expect(page.text()).not.toContain('永久删除项目');
  page.unmount(); page = undefined; f.state.available = true; f.identity.admin = false;
  const before = f.calls.length; page = await renderApp('/admin/projects');
  expect(page.text()).toContain('仅平台管理员可见'); expect(f.calls).toHaveLength(before);
});

test.each(['/admin/projects', '/admin/integrations'])('%s restores the current last-row trigger and original scroll after a background capability loss rebuilds its action', async route => {
  const f = fixture(); f.state.available = true; page = await renderApp(`${route}?q=managed`); await page.click('下一页');
  const main = document.querySelector('main')!, trigger = [...document.querySelectorAll('tbody tr')].at(-1)!.querySelectorAll('button');
  const original = [...trigger].find(button => button.textContent === '永久删除项目')!;
  main.scrollTop = 700; await act(async () => { original.focus(); original.click(); }); await page.settle();
  f.state.available = false; await page.reread(); expect(document.querySelectorAll('dialog[open]')).toHaveLength(0); expect(original.isConnected).toBe(false);
  // A real scroll viewport clamps when its actions shrink; happy-dom has no layout engine.
  main.scrollTop = 0;
  f.state.available = true; await page.reread(); expect(document.querySelectorAll('dialog[open]')).toHaveLength(1);
  const current = [...document.querySelectorAll('tbody tr')].at(-1)!.querySelectorAll('button'), restored = [...current].find(button => button.textContent === '永久删除项目')!;
  expect(restored === original).toBe(false); await page.click('关闭'); await page.settle();
  expect(document.activeElement === restored).toBe(true); expect(main.scrollTop).toBe(700);
  expect(page.search()).toMatchObject({ q: 'managed', cursor: '20' }); expect(document.querySelectorAll('tbody tr')).toHaveLength(20);
  expect(f.calls.filter(call => call.path.endsWith('/deletions'))).toHaveLength(0);
});
