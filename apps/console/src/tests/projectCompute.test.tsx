import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { renderApp } from './renderApp';
import { computePagePath, computePolicyPath, projectComputeFixture } from './projectComputeFixture';
import { computeBackend, profileIdOf, profileDetail } from './computeProfileFixture';
import { blankDraft, toCreateRequest } from '../features/admin/model/profileDraft';

const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(async () => { page?.unmount(); page = undefined; await new Promise((r) => setTimeout(r, 0)); globalThis.fetch = originalFetch; });
const select = (label: string) => [...document.querySelectorAll('label')].find((node) => node.textContent?.startsWith(label))!.querySelector('select')!;
const setSelect = async (label: string, value: string) => { await act(async () => { const node = select(label); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event('change', { bubbles: true })); }); await page!.settle(); };
const check = async (name: string) => { const node = [...document.querySelectorAll('fieldset label')].find((label) => label.querySelector('strong')?.textContent === name)!.querySelector('input')!; await act(async () => node.click()); await page!.settle(); };
const button = (label: string) => [...document.querySelectorAll('button')].find((node) => node.textContent === label)!;

test('授权页载入后显示继承规则；单独授予隐藏档位、项目默认及开发套餐随同一版本保存', async () => {
  const f = projectComputeFixture(); page = await renderApp(computePagePath);
  expect(page.text()).toContain('继承平台默认档位：standard'); expect(button('保存项目授权').disabled).toBe(true);
  await setSelect('Agent 档位范围', 'restricted');
  expect(page.text()).toContain('默认不可见的档位也可单独授予此项目');
  await check('private-large'); await check('aider-shell');
  expect([...select('项目默认 Agent 档位').options].map((o) => o.value)).toEqual(['', profileIdOf('private-large')]);
  await setSelect('项目默认 Agent 档位', profileIdOf('private-large')); await setSelect('开发容器资源套餐', profileIdOf('coding-large'));
  await page.click('保存项目授权');
  expect(f.writes).toEqual([{ expectedRevision: 0, policy: { mode: 'restricted', allowedProfiles: [profileIdOf('private-large'), profileIdOf('aider-shell')], defaultProfile: profileIdOf('private-large'), devTaskProfile: profileIdOf('coding-large') } }]);
  expect(page.text()).toContain('项目算力授权已保存'); expect(button('保存项目授权').disabled).toBe(true);
  await setSelect('Agent 档位范围', 'inherit'); expect(page.text()).toContain('继承平台默认档位：standard');
  await page.click('保存项目授权');
  expect(f.writes.at(-1)).toEqual({ expectedRevision: 1, policy: { mode: 'inherit', allowedProfiles: [], defaultProfile: null, devTaskProfile: profileIdOf('coding-large') } });
});

test('取消默认档位的授权时显示字段错误并保留草稿；并发冲突不覆盖服务端，重新读取需确认丢弃', async () => {
  const f = projectComputeFixture(); page = await renderApp(computePagePath);
  await setSelect('Agent 档位范围', 'restricted'); await check('private-large'); await setSelect('项目默认 Agent 档位', profileIdOf('private-large')); await check('private-large');
  await page.click('保存项目授权');
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('请选择允许范围'); expect(f.writes).toEqual([]);
  await check('private-large'); f.state.conflict = true;
  await page.click('保存项目授权'); expect(page.text()).toContain('本次修改未保存');
  expect(select('项目默认 Agent 档位').value).toBe(profileIdOf('private-large'));
  await page.click('放弃 Agent 配置修改'); expect(page.text()).toContain('放弃当前修改'); expect(select('项目默认 Agent 档位').value).toBe(profileIdOf('private-large'));
  await page.click('确认'); expect(select('Agent 档位范围').value).toBe('inherit');
});

test('目录为空仍可明确禁止全部 Agent，读失败可重试；载入期间没有可保存的表单', async () => {
  const f = projectComputeFixture(); let finish!: () => void; f.state.hold = new Promise<void>((resolve) => { finish = resolve; });
  page = await renderApp(computePagePath); expect(button('保存项目授权')).toBeUndefined();
  f.state.error = true; finish(); await page.settle(); expect(page.text()).toContain('授权目录离线');
  f.state.error = false; f.state.hold = undefined; f.state.profiles = [];
  await page.reread(); await setSelect('Agent 档位范围', 'restricted');
  await page.click('保存项目授权');
  expect(f.writes).toEqual([{ expectedRevision: 0, policy: { mode: 'restricted', allowedProfiles: [], defaultProfile: null, devTaskProfile: null } }]);
});

test('非管理员不会读取授权编辑资料；保存前身份变化时保留草稿且不提交', async () => {
  const f = projectComputeFixture(); f.state.admin = false; page = await renderApp(computePagePath);
  expect(f.calls).not.toContain(computePolicyPath); expect(button('保存项目授权')).toBeUndefined();
  page.unmount(); f.state.admin = true; page = await renderApp(computePagePath);
  await setSelect('Agent 档位范围', 'restricted'); f.state.admin = false;
  await page.click('保存项目授权'); expect(page.text()).toContain('管理员身份已变化'); expect(f.writes).toEqual([]);
});

test('档位行能切换默认可见性，平台默认的隐藏操作不可用；新建请求保留可见性选择', async () => {
  const f = computeBackend([profileDetail({ name: 'public', isDefault: true, defaultVisible: true }), profileDetail({ name: 'private', defaultVisible: false })]);
  page = await renderApp('/admin/compute');
  const rows = [...document.querySelectorAll('tr')];
  const expand = async (name: string) => { const row = rows.find((r) => r.textContent?.includes(name))!; const b = [...row.querySelectorAll('button')].find((b) => b.textContent?.includes('更多'))!; await act(async () => b.click()); await page!.settle(); };
  await expand('public'); expect(button('默认可见').disabled).toBe(true);
  await expand('private');
  const action = [...document.querySelectorAll('button')].find((b) => b.textContent === '默认可见' && !b.disabled)!;
  await act(async () => action.click()); await page.settle(); await page.click('确认');
  expect(f.writes.at(-1)).toMatchObject({ method: 'PUT', path: `/v1/admin/compute-profiles/${profileIdOf('private')}/default-visible`, body: { defaultVisible: true } });
  expect(toCreateRequest({ ...blankDraft('opencode'), defaultVisible: false }).defaultVisible).toBe(false);
});
