import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { ProjectQuotaCard } from '../features/admin/components/projects/ProjectQuotaCard';
import { messages } from '../features/admin/i18n/zh-CN';
import { renderRouteElement } from './renderRouteElement';
import { ADMIN_ID } from './computeProfileFixture';
import { computeProjectId } from './projectComputeFixture';
import { projectResourcesFixture, quotaPath } from './adminProjectResourcesFixture';

// 旧配额编辑器保留兼容保护；正式入口与二次确认由 resourceCenter.test.tsx 验证。
const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderRouteElement>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });
const field = (label: string) => [...document.querySelectorAll('label')].find((node) => node.textContent?.startsWith(label))!.querySelector<HTMLInputElement>('input')!;
const input = async (label: string, value: string) => { await act(async () => { const node = field(label); node.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true })); }); await page!.settle(); };
const renderQuota = () => renderRouteElement(<ProjectQuotaCard projectId={computeProjectId} viewerId={ADMIN_ID} />, messages);

test('兼容配额编辑器：配额所有边界显示字段错误；降低额度提交旧值，保存后仍显示真实占用', async () => {
  const f = projectResourcesFixture(); page = await renderQuota();
  for (const value of ['', '0', '101', '1.5']) {
    await input('最大并发任务数', value); await page.click('保存任务配额');
    expect(field('最大并发任务数').getAttribute('aria-invalid')).toBe('true'); expect(f.writes).toHaveLength(0);
  }
  await input('最大并发任务数', '1'); await page.click('保存任务配额');
  expect(f.writes).toEqual([{ path: quotaPath, body: { maxConcurrentTasks: 1, expectedMaxConcurrentTasks: 3 } }]);
  expect(page.text()).toContain('4 个／配额 1 个'); expect(page.text()).toContain('项目任务配额已保存');
});

test('兼容配额编辑器：配额冲突和不匹配回执保留草稿，重新读取需确认；身份变化不写入', async () => {
  const f = projectResourcesFixture(); page = await renderQuota(); await input('最大并发任务数', '8');
  f.state.conflict = true; await page.click('保存任务配额'); expect(field('最大并发任务数').value).toBe('8'); expect(page.text()).toContain('本次修改未保存');
  f.state.conflict = false; f.state.mismatch = true; await page.click('保存任务配额'); expect(page.text()).toContain('保存回执与本次输入不一致'); expect(field('最大并发任务数').value).toBe('8');
  f.state.mismatch = false; await page.click('放弃配额修改'); await page.click('确认'); expect(field('最大并发任务数').value).toBe('8');
  await input('最大并发任务数', '9'); f.compute.state.admin = false; await page.click('保存任务配额'); expect(f.writes).toHaveLength(2); expect(page.text()).toContain('管理员身份已变化');
});
