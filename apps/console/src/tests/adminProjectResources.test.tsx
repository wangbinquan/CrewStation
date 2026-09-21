import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { renderApp } from './renderApp';
import { computePagePath } from './projectComputeFixture';
import { projectResourcesFixture, quotaPath, resourcePagePath, servicePolicyPath, serviceTemplatePath } from './adminProjectResourcesFixture';

const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });
const field = (label: string) => [...document.querySelectorAll('label')].find((node) => node.textContent?.startsWith(label))!.querySelector<HTMLInputElement | HTMLSelectElement>('input,select')!;
const select = async (label: string, value: string) => { await act(async () => { const node = field(label); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event('change', { bubbles: true })); }); await page!.settle(); };
const input = async (label: string, value: string) => { await act(async () => { const node = field(label); node.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true })); }); await page!.settle(); };
const choosePlan = async () => { await act(async () => { const label = [...document.querySelectorAll('fieldset label')].find((node) => node.textContent?.includes('服务标准'))!; label.querySelector<HTMLInputElement>('input')!.click(); }); await page!.settle(); };

test('旧算力入口跳转统一资源页，服务、开发 Agent 与真实配额同时可读', async () => {
  projectResourcesFixture(); page = await renderApp(computePagePath);
  expect(page.path()).toBe(resourcePagePath);
  for (const text of ['资源配置', '服务运行资源', 'Agent 与开发容器', '任务并发配额', '4 个／配额 3 个', '全部 1 个共享服务规格']) expect(page.text()).toContain(text);
  const nav = document.querySelector('nav[aria-label="主导航"]')!;
  expect(nav.textContent).not.toContain('服务套餐'); expect(nav.textContent).not.toContain('任务容器套餐');
  expect(nav.querySelector('a[aria-current="page"]')?.textContent).toBe('项目管理');
});

test('独立分配服务规格按版本保存，另一张配额卡片的草稿保持；空清单可明确禁止部署', async () => {
  const f = projectResourcesFixture(); page = await renderApp(resourcePagePath);
  await input('最大并发任务数', '8'); await select('服务规格范围', 'restricted'); await choosePlan(); await page.click('保存服务资源');
  expect(f.writes).toEqual([{ path: servicePolicyPath, body: { expectedRevision: 0, policy: { mode: 'restricted', allowedPlanIds: [f.plan.id] } } }]);
  expect(field('最大并发任务数').value).toBe('8'); expect(page.text()).toContain('项目服务规格范围已保存');
  await choosePlan(); await page.click('保存服务资源');
  expect(f.writes.at(-1)?.body).toEqual({ expectedRevision: 1, policy: { mode: 'restricted', allowedPlanIds: [] } });
  await select('服务规格范围', 'inherit'); await page.click('保存服务资源');
  expect(f.writes.at(-1)?.body).toEqual({ expectedRevision: 2, policy: { mode: 'inherit', allowedPlanIds: [] } });
});

test('冲突保留选择，服务重读仅放弃本卡草稿，Agent 与配额编辑都保留', async () => {
  const f = projectResourcesFixture(); page = await renderApp(resourcePagePath);
  await select('Agent 档位范围', 'restricted'); await input('最大并发任务数', '7');
  await select('服务规格范围', 'restricted'); await choosePlan(); f.state.conflict = true; await page.click('保存服务资源');
  expect(page.text()).toContain('本次修改未保存'); expect(field('服务规格范围').value).toBe('restricted');
  await page.click('重新读取服务配置'); expect(page.text()).toContain('其他区域的草稿会保留'); await page.click('确认');
  expect(field('服务规格范围').value).toBe('inherit'); expect(field('Agent 档位范围').value).toBe('restricted'); expect(field('最大并发任务数').value).toBe('7');
});

test('配额所有边界显示字段错误；降低额度提交旧值，保存后仍显示真实占用', async () => {
  const f = projectResourcesFixture(); page = await renderApp(resourcePagePath);
  for (const value of ['', '0', '101', '1.5']) {
    await input('最大并发任务数', value); await page.click('保存任务配额');
    expect(field('最大并发任务数').getAttribute('aria-invalid')).toBe('true'); expect(f.writes).toHaveLength(0);
  }
  await input('最大并发任务数', '1'); await page.click('保存任务配额');
  expect(f.writes).toEqual([{ path: quotaPath, body: { maxConcurrentTasks: 1, expectedMaxConcurrentTasks: 3 } }]);
  expect(page.text()).toContain('4 个／配额 1 个'); expect(page.text()).toContain('项目任务配额已保存');
});

test('服务配置不可读时不出现可保存空表，其他卡片可用；目录为空与读取错误可区分', async () => {
  const f = projectResourcesFixture(); f.state.serviceError = true; page = await renderApp(resourcePagePath);
  expect(page.text()).toContain('服务范围暂不可读'); expect(page.text()).not.toContain('保存服务资源'); expect(page.text()).toContain('保存任务配额');
  f.state.serviceError = false; f.state.plans = []; await page.click('重新读取服务配置'); await select('服务规格范围', 'restricted');
  expect(page.text()).toContain('共享目录暂无服务规格'); await page.click('保存服务资源'); expect(f.writes[0]?.body.policy).toEqual({ mode: 'restricted', allowedPlanIds: [] });
});

test('配额冲突和不匹配回执保留草稿，重新读取需确认；身份变化不写入', async () => {
  const f = projectResourcesFixture(); page = await renderApp(resourcePagePath); await input('最大并发任务数', '8');
  f.state.conflict = true; await page.click('保存任务配额'); expect(field('最大并发任务数').value).toBe('8'); expect(page.text()).toContain('本次修改未保存');
  f.state.conflict = false; f.state.mismatch = true; await page.click('保存任务配额'); expect(page.text()).toContain('保存回执与本次输入不一致'); expect(field('最大并发任务数').value).toBe('8');
  f.state.mismatch = false; await page.click('重新读取配额'); await page.click('确认'); expect(field('最大并发任务数').value).toBe('8');
  await input('最大并发任务数', '9'); f.compute.state.admin = false; await page.click('保存任务配额'); expect(f.writes).toHaveLength(2); expect(page.text()).toContain('管理员身份已变化');
});

test('两类旧模板地址进入项目管理，模板明确共享范围，切页签前保护草稿', async () => {
  projectResourcesFixture(); page = await renderApp('/admin/service-plans');
  expect(page.path()).toBe(serviceTemplatePath); expect(page.search().kind).toBe('service'); expect(page.text()).toContain('全平台共享模板');
  await input('名称', '未保存模板'); await page.click('任务容器规格模板'); expect(page.search().kind).toBe('service'); expect(page.text()).toContain('未保存');
  await page.click('继续编辑'); expect(field('名称').value).toBe('未保存模板');
  await page.click('任务容器规格模板'); await page.click('放弃输入并离开'); expect(page.search().kind).toBe('task'); expect(page.text()).toContain('存储');
  await page.navigate('/admin/task-profiles'); expect(page.path()).toBe(serviceTemplatePath); expect(page.search().kind).toBe('task');
});

test('不存在的服务规格逐项提示，错误回执不显示保存成功，重新读取不伪造有效配置', async () => {
  const f = projectResourcesFixture(), missing = Bun.randomUUIDv7(); f.state.service.policy = { mode: 'restricted', allowedPlanIds: [missing] };
  page = await renderApp(resourcePagePath); expect(page.text()).toContain('规格已不存在'); await choosePlan(); await page.click('保存服务资源');
  expect(document.querySelector('fieldset[aria-invalid="true"]')).not.toBeNull(); expect(f.writes).toHaveLength(0);
  await act(async () => { [...document.querySelectorAll('fieldset label')].find((node) => node.textContent?.includes(missing))!.querySelector<HTMLInputElement>('input')!.click(); }); await page.settle();
  f.state.mismatch = true; await page.click('保存服务资源'); expect(page.text()).toContain('保存回执与本次输入不一致'); expect(page.text()).not.toContain('项目服务规格范围已保存');
  f.state.mismatch = false; await page.click('重新读取服务配置'); await page.click('确认');
  expect(page.text()).not.toContain(missing); expect(field('服务规格范围').value).toBe('restricted');
});

test('服务保存中的重复提交只写一次且离开按钮暂不可用；配额读失败可以独立恢复', async () => {
  const f = projectResourcesFixture(); f.state.quotaError = true; page = await renderApp(resourcePagePath);
  expect(page.text()).toContain('配额暂不可读'); f.state.quotaError = false; await page.click('重新读取配额'); expect(field('最大并发任务数').value).toBe('3');
  await select('服务规格范围', 'restricted'); await choosePlan();
  let finish!: () => void; f.state.hold = new Promise<void>((resolve) => { finish = resolve; }); await page.click('保存服务资源');
  await act(async () => { const form = field('服务规格范围').closest('form')!; form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await page.requestNavigate('/admin'); expect([...document.querySelectorAll('button')].find((node) => node.textContent === '放弃输入并离开')?.disabled).toBe(true);
  await page.click('继续编辑'); f.state.hold = undefined; await act(async () => finish()); await page.settle();
  expect(f.writes).toHaveLength(1); expect(page.text()).toContain('项目服务规格范围已保存');
});
