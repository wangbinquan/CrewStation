import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { DataResourcesTable } from '../features/dev-session/components/panel/DataResourcesTable';
import { messages } from '../features/dev-session/i18n/zh-CN';
import { renderElement } from './renderElement';
import { dialogConfirmButton, typeConfirmWord } from './confirmDialogDriver';

const original = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderElement>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = original; });
function setup(admin: boolean) {
  const writes: unknown[] = [], state = { fail: false };
  globalThis.fetch = (async (raw, init) => {
    const path = new URL(String(raw), 'http://localhost').pathname;
    let value: unknown = path.endsWith('/me') ? { isAdmin: admin } : { items: [{ id: 'db-1', kind: 'postgres', state: 'ready', env: 'production', plan: 'small', envVar: 'CS_DATABASE_URL' }] };
    let status = 200;
    if (init?.method === 'POST') {
      writes.push([path, JSON.parse(String(init.body))]);
      if (state.fail) { value = { error: 'conflict', message: '项目仍有运行中的使用者' }; status = 409; }
      else value = {};
    }
    return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { writes, state };
}
test('仅管理员显示轮换，确认词与后果初始可见；冲突保留弹窗，重试成功提示下次启动生效', async () => {
  const f = setup(true);
  page = await renderElement(<DataResourcesTable projectId="project-1" />, messages);
  await page.click('轮换口令');
  expect(page.text()).toContain('不会自动重启任何容器');
  expect(dialogConfirmButton().disabled).toBe(true);
  await typeConfirmWord('rotate');
  f.state.fail = true;
  await page.click('轮换口令');
  expect(page.text()).toContain('项目仍有运行中的使用者');
  expect(f.writes).toEqual([['/v1/data/resources/db-1/rotate-credential', { confirmation: 'rotate' }]]);
  f.state.fail = false;
  await page.click('轮换口令');
  expect(page.text()).toContain('口令已轮换，下次启动将使用新口令');
  expect(document.querySelector('dialog[open]')).toBeNull();
});
test('普通成员没有轮换入口', async () => {
  setup(false);
  page = await renderElement(<DataResourcesTable projectId="project-1" />, messages);
  expect(page.text()).not.toContain('轮换口令');
});
