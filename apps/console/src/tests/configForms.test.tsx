import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { renderApp } from './renderApp';
import { browserHistoryFixture } from './browserHistoryFixture';

const originalFetch = globalThis.fetch, projectId = `prj_${'a'.repeat(32)}`, serviceId = `svc_${'b'.repeat(32)}`, userId = `usr_${'c'.repeat(32)}`;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });

function fixture() {
  const state = { failSave: false, failRead: false, failVersions: false, hold: undefined as Promise<void> | undefined };
  const writes: Array<{ path: string; method: string; body?: Record<string, unknown> }> = [];
  const item = { name: 'GREETING', value: '当前值', isSecret: false, version: 3, env: 'development', updatedBy: userId, updatedAt: '2026-09-13T01:00:00.000Z' };
  globalThis.fetch = (async (raw, init) => {
    const path = new URL(String(raw), 'http://localhost').pathname, method = init?.method ?? 'GET';
    let body: unknown = { items: [] }, status = 200;
    if (method !== 'GET') {
      const input = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined; writes.push({ path, method, body: input });
      if (state.hold) await state.hold;
      if (state.failSave) { status = 503; body = { error: 'unavailable', message: '配置服务暂不可用' }; }
      else if (method === 'DELETE') return new Response(null, { status: 204 });
      else body = { ...item, ...input, version: 4 };
    } else if (path === '/v1/me') body = { id: userId, name: '负责人', email: 'owner@test.invalid', isAdmin: false, memberships: [{ projectId, role: 'owner' }] };
    else if (path === `/v1/projects/${projectId}`) body = { id: projectId, serviceId, slug: 'demo', name: '演示应用', kind: 'DigitalWorker', ownerUserId: userId, state: 'active' };
    else if (/\/config\/(development|production)$/.test(path)) {
      if (state.failRead) { status = 503; body = { error: 'unavailable', message: '配置读取失败' }; }
      else body = { items: [{ ...item, env: path.endsWith('production') ? 'production' : 'development' }, { ...item, name: 'API_TOKEN', isSecret: true, value: undefined }] };
    } else if (path.endsWith('/versions') && state.failVersions) { status = 503; body = { error: 'unavailable', message: '历史服务暂不可用' }; }
    else if (path.endsWith('/dev-session')) { status = 404; body = { error: 'not_found', message: '无会话' }; }
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { state, writes };
}

const visible = <T extends HTMLElement>(selector: string) => [...document.querySelectorAll<T>(selector)].find((element) => !element.closest('[hidden]'))!;
async function input(node: HTMLInputElement, value: string) {
  await act(async () => { node.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true })); });
  await page!.settle();
}
async function click(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find((element) => !element.closest('[hidden]') && element.textContent === label)!;
  expect(button).toBeDefined(); await act(async () => { button.click(); }); await page!.settle();
}

test('配置保存失败保留值；成功后才清空输入并反馈真实版本和生效条件', async () => {
  const f = fixture(); f.state.failSave = true; page = await renderApp(`/projects/${projectId}/settings?tab=config`);
  await input(visible('input[placeholder="DATABASE_URL"]'), 'NEW_VALUE');
  await input(visible('input[placeholder="写入后生效于下一次注入"]'), '需要保留的内容'); await click('保存');
  // 原实现调用 onSubmit 后立即 setValue('')，503 时用户输入已被丢弃。
  expect(visible<HTMLInputElement>('input[placeholder="写入后生效于下一次注入"]').value).toBe('需要保留的内容');
  expect(page.text()).toContain('配置服务暂不可用'); f.state.failSave = false; await click('保存');
  expect(visible<HTMLInputElement>('input[placeholder="写入后生效于下一次注入"]').value).toBe('');
  expect(page.text()).toContain('第 4 版'); expect(page.text()).toContain('现有进程不会自动加载');
  expect(f.writes.at(-1)?.body).toEqual({ name: 'NEW_VALUE', value: '需要保留的内容', isSecret: false, env: 'development' });
});

test('键名规则与空值语义首屏可见；非法键有字段反馈并聚焦，空字符串是有效写入', async () => {
  const f = fixture(); page = await renderApp(`/projects/${projectId}/settings?tab=config`);
  expect(page.text()).toContain('大写字母开头'); expect(page.text()).toContain('留空保存会写入空值');
  const key = visible<HTMLInputElement>('input[placeholder="DATABASE_URL"]');
  await input(key, 'wrong-key'); await click('保存'); expect(f.writes).toHaveLength(0);
  expect(key.getAttribute('aria-invalid')).toBe('true'); expect(document.activeElement).toBe(key);
  await input(key, 'EMPTY_VALUE'); await click('保存'); expect(f.writes[0]?.body).toMatchObject({ name: 'EMPTY_VALUE', value: '' });
});

test('填入普通键保留可读值，密钥不预填；两组失败草稿各自保留', async () => {
  const f = fixture(); f.state.failSave = true; page = await renderApp(`/projects/${projectId}/settings?tab=config`);
  await click('填入表单'); expect(visible<HTMLInputElement>('input[placeholder="写入后生效于下一次注入"]').value).toBe('当前值');
  expect(page.text()).toContain('正在覆盖已存在的键 GREETING');
  const secretRow = [...document.querySelectorAll<HTMLTableRowElement>('tr')].find((row) => !row.closest('[hidden]') && row.textContent?.includes('API_TOKEN'))!;
  await act(async () => { secretRow.querySelector('button')!.click(); }); await page.settle();
  expect(visible<HTMLInputElement>('input[placeholder="写入后生效于下一次注入"]').value).toBe(''); expect(page.text()).toContain('旧密钥无法读回');
  await input(visible('input[placeholder="写入后生效于下一次注入"]'), '开发草稿'); await click('保存');
  await page.click('生产取值组'); await input(visible('input[placeholder="DATABASE_URL"]'), 'PRODUCTION_VALUE');
  await input(visible('input[placeholder="写入后生效于下一次注入"]'), '生产草稿'); await click('保存');
  expect(f.writes.at(-1)?.path).toBe(`/v1/projects/${projectId}/config/production`);
  await page.click('开发取值组'); expect(visible<HTMLInputElement>('input[placeholder="写入后生效于下一次注入"]').value).toBe('开发草稿');
  await page.click('生产取值组'); expect(visible<HTMLInputElement>('input[placeholder="写入后生效于下一次注入"]').value).toBe('生产草稿');
});

test('保存进行中防止清空、切编辑项、重复保存与删除；暂时读取失败保留输入且可恢复', async () => {
  const f = fixture(); page = await renderApp(`/projects/${projectId}/settings?tab=config`);
  await input(visible('input[placeholder="DATABASE_URL"]'), 'EDIT_VALUE'); await input(visible('input[placeholder="写入后生效于下一次注入"]'), '草稿');
  let finish!: () => void; f.state.hold = new Promise<void>((resolve) => { finish = resolve; });
  await click('保存'); await click('保存中…'); await click('清空'); await click('填入表单'); await click('删除');
  expect(f.writes).toHaveLength(1); expect(visible<HTMLInputElement>('input[placeholder="写入后生效于下一次注入"]').value).toBe('草稿');
  await act(async () => { finish(); }); await page.settle(); f.state.hold = undefined;
  await input(visible('input[placeholder="写入后生效于下一次注入"]'), '未提交的新内容'); f.state.failRead = true; await click('刷新配置');
  expect(page.text()).toContain('配置读取失败'); expect(visible<HTMLInputElement>('input[placeholder="写入后生效于下一次注入"]').value).toBe('未提交的新内容');
  await click('保存'); expect(f.writes).toHaveLength(1);
  f.state.failRead = false; f.state.failVersions = true; await click('刷新配置'); expect(page.text()).toContain('历史服务暂不可用');
  expect(visible<HTMLInputElement>('input[placeholder="写入后生效于下一次注入"]').disabled).toBe(false); await click('保存'); expect(f.writes).toHaveLength(2);
});

test('编辑另一配置或离开设置前可保留未保存输入，确认放弃后才跳转', async () => {
  fixture(); page = await renderApp(`/projects/${projectId}/settings?tab=config`);
  await input(visible('input[placeholder="DATABASE_URL"]'), 'DRAFT_KEY');
  await input(visible('input[placeholder="写入后生效于下一次注入"]'), '不可丢的草稿'); await click('填入表单');
  // 旧界面直接换 key 重挂表单，未保存值随组件被销毁。
  expect(visible<HTMLInputElement>('input[placeholder="写入后生效于下一次注入"]').value).toBe('不可丢的草稿');
  await click('继续编辑'); await page.click('仓库');
  expect(page.search().tab).toBe('config'); expect(page.text()).toContain('未保存的输入');
  await click('继续编辑'); expect(visible<HTMLInputElement>('input[placeholder="写入后生效于下一次注入"]').value).toBe('不可丢的草稿');
  await page.click('仓库'); await click('放弃输入并离开'); expect(page.search().tab).toBe('repository');
});

test('放弃载入与清空都明确确认；成功保存后的空值不再被误判为未保存', async () => {
  const f = fixture(); page = await renderApp(`/projects/${projectId}/settings?tab=config`);
  await input(visible('input[placeholder="DATABASE_URL"]'), 'FIRST_DRAFT'); await click('填入表单'); await click('放弃输入并载入');
  expect(visible<HTMLInputElement>('input[placeholder="写入后生效于下一次注入"]').value).toBe('当前值');
  await input(visible('input[placeholder="写入后生效于下一次注入"]'), '新值'); await click('清空'); expect(page.text()).toContain('空白表单'); await click('继续编辑');
  expect(visible<HTMLInputElement>('input[placeholder="写入后生效于下一次注入"]').value).toBe('新值');
  await click('保存'); await page.click('仓库'); expect(page.search().tab).toBe('repository'); expect(f.writes).toHaveLength(1);
});

test('后台环境草稿也会阻止离开；一次只确认第一个目的地，取消和返回均不写入', async () => {
  const f = fixture(), initial = `/projects/${projectId}/settings?tab=config`;
  const browser = browserHistoryFixture(['/projects', initial]); page = await renderApp(initial, undefined, browser.history);
  await input(visible('input[placeholder="DATABASE_URL"]'), 'DEV_HIDDEN'); await page.click('生产取值组');
  await page.click('仓库'); await page.click('成员');
  expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(1); expect(page.search().tab).toBe('config');
  await click('放弃输入并离开'); expect(page.search().tab).toBe('repository'); expect(f.writes).toHaveLength(0);
  await page.back(); expect(page.search().tab).toBe('config');
  await input(visible('input[placeholder="DATABASE_URL"]'), 'PROD_BACK'); await page.back(); expect(page.search().env).toBe('development');
  await page.back(); expect(page.search().tab).toBe('config'); await click('继续编辑'); expect(f.writes).toHaveLength(0);
  expect(browser.beforeUnload()).toBe(false);
  await page.back(); await click('放弃输入并离开'); expect(page.path()).toBe('/projects');
});
