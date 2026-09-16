import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act, useState } from 'react';
import type { TaskDataBindingDto } from '@crewstation/contracts';
import { DataBindingPane } from '../features/dev-session/components/DataBindingPane';
import { useDataBindings } from '../features/dev-session/hooks/useDataBindings';
import { messages } from '../features/dev-session/i18n/zh-CN';
import { renderElement } from './renderElement';
import { bindingDisplayState, productionAccessModes } from '../features/dev-session/model/dataAccessForm';

const projectId = `prj_${'a'.repeat(32)}`, taskId = `tsk_${'b'.repeat(32)}`, serviceId = `svc_${'c'.repeat(32)}`;
const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderElement>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });
function Harness({ canDevelop = true, canManage = true, service = serviceId }: { readonly canDevelop?: boolean; readonly canManage?: boolean; readonly service?: string | null }) { return <DataBindingPane data={useDataBindings(projectId, taskId, service ?? undefined, { canDevelop, canManage })} />; }
const record = (id: string, patch: Partial<TaskDataBindingDto> = {}): TaskDataBindingDto => ({ id, taskId: taskId as TaskDataBindingDto['taskId'], mode: 'diagnostic-readonly', state: 'requested', ttlMinutes: 30, requestedBy: `usr_${'d'.repeat(32)}` as TaskDataBindingDto['requestedBy'], requestedByName: '开发者小李', createdAt: '2026-09-13T00:00:00.000Z', ...patch });
function setup(items: TaskDataBindingDto[] = []) {
  const requests: Array<{ path: string; body?: Record<string, unknown> }> = [];
  const state = { items, failRead: false, failWrite: false, hold: undefined as Promise<void> | undefined };
  globalThis.fetch = (async (raw, init) => {
    const path = new URL(String(raw), 'http://localhost').pathname;
    let result: unknown = { items: state.items }, status = 200;
    if (init?.method === 'POST') {
      const body = init.body ? JSON.parse(String(init.body)) : undefined; requests.push({ path, body });
      if (state.hold) await state.hold;
      if (state.failWrite) { status = 503; result = { error: 'unavailable', message: '数据服务暂不可用' }; }
      else if (path.endsWith('/decision') || path.endsWith('/revoke')) {
        const binding = state.items.find((item) => path.includes(`/${item.id}/`))!;
        const updated = { ...binding, state: path.endsWith('/revoke') ? 'revoked' : body.approve ? 'active' : 'rejected', decision: body?.decision, expiresAt: '2099-09-13T01:00:00.000Z' } as TaskDataBindingDto;
        state.items = state.items.map((item) => item.id === binding.id ? updated : item); result = updated;
      } else {
        const binding = record(`binding-${requests.length}`, { ...body, ttlMinutes: body.ttlMinutes ?? 120, state: body.mode === 'development' ? 'active' : 'requested' });
        state.items = [...state.items, binding]; result = binding;
      }
    } else if (state.failRead) { status = 503; result = { error: 'unavailable', message: '读取绑定失败' }; }
    return new Response(JSON.stringify(result), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { requests, state };
}
const field = (label: string) => [...page!.host.querySelectorAll('label')].find((node) => node.textContent?.includes(label))?.querySelector<HTMLInputElement>('input, textarea, select');
const openDetails = async () => { await act(async () => page!.host.querySelector('summary')!.click()); };
const input = async (node: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) => {
  await act(async () => {
    node.focus(); const proto = node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); node.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
  });
};

test('生产访问的时长和用途限制首屏可见，每个无效字段提示且不提交', async () => {
  const f = setup(); page = await renderElement(<Harness />, messages);
  // 原表单省略 ttlMinutes，用户无法知道获批时长，更无法调整。
  expect(field('有效时长')).toBeDefined(); expect(page.text()).toContain('5–1440'); expect(page.text()).toContain('500');
  await input(field('有效时长')!, '4'); await input(field('申请理由')!, '字'.repeat(501)); await page.click('提交申请');
  expect(page.host.querySelectorAll('[aria-invalid="true"]')).toHaveLength(2); expect(f.requests).toHaveLength(0);
});

test('申请准确绑定当前服务／任务，失败和读故障保留输入，恢复后成功才清理用途', async () => {
  const f = setup(); f.state.failWrite = true; page = await renderElement(<Harness />, messages);
  await input(field('申请模式')!, 'production-change'); await input(field('有效时长')!, '1440'); await input(field('申请理由')!, '  修复数据  ');
  await page.click('提交申请'); expect(page.text()).toContain('数据服务暂不可用'); expect(field('申请理由')!.value).toBe('  修复数据  ');
  expect(f.requests[0]).toEqual({ path: `/v1/services/${serviceId}/tasks/${taskId}/data-bindings`, body: { mode: 'production-change', reason: '修复数据', ttlMinutes: 1440 } });
  f.state.failRead = true; await page.click('刷新访问记录'); expect(page.text()).toContain('读取绑定失败'); expect(page.button('提交申请').disabled).toBe(true); expect(field('申请理由')!.value).toBe('  修复数据  ');
  f.state.failRead = false; f.state.failWrite = false; await page.click('刷新访问记录'); await page.click('提交申请');
  expect(field('申请理由')!.value).toBe(''); expect(field('有效时长')!.value).toBe('1440'); expect(page.text()).toContain('已受理「生产数据读写」申请'); expect(page.text()).toContain('待批准');
  expect(page.text()).toContain('容器不会因批准自动加载新的连接'); expect(page.text()).not.toContain('应用已连接生产');
});

test('空时长保持平台默认，开发模式不用生产期限；重复提交和写入中的其他操作受同一锁保护', async () => {
  const f = setup([record('existing')]); let finish: () => void;
  f.state.hold = new Promise((resolve) => { finish = resolve; }); page = await renderElement(<Harness />, messages); await openDetails();
  const submit = page.button('提交申请'); await act(async () => { submit.click(); submit.click(); }); await page.settle();
  expect(f.requests).toHaveLength(1); expect(f.requests[0]!.body).toEqual({ mode: 'diagnostic-readonly' }); expect(page.button('批准').disabled).toBe(true); expect(page.button('刷新访问记录').disabled).toBe(true);
  await act(async () => finish!()); await page.settle();
  await input(field('有效时长')!, '5'); await input(field('申请模式')!, 'development'); expect(field('有效时长')).toBeUndefined(); expect(page.text()).toContain('不按生产访问的时长过期');
  await page.click('提交申请'); expect(f.requests.at(-1)!.body).toEqual({ mode: 'development' });
});

test('负责人审批看到真实期限，意见取消与失败保留，确认批准后仍显示接入待确认', async () => {
  const f = setup([record('request-ro')]); page = await renderElement(<Harness />, messages); await openDetails();
  expect(page.text()).toContain('有效时长（分钟）30'); await page.click('批准');
  await input(field('审批意见')!, '字'.repeat(501)); await page.click('确认批准'); expect(f.requests).toHaveLength(0); expect(field('审批意见')!.getAttribute('aria-invalid')).toBe('true');
  await input(field('审批意见')!, '  仅用于排错  '); await page.click('取消'); expect(page.text()).toContain('未提交的审批意见');
  await page.click('拒绝'); expect(field('审批意见')!.value).toBe('  仅用于排错  '); f.state.failWrite = true; await page.click('确认拒绝');
  expect(page.text()).toContain('数据服务暂不可用'); expect(field('审批意见')!.value).toBe('  仅用于排错  ');
  await page.click('取消'); f.state.failWrite = false; await page.click('批准'); await page.click('确认批准');
  expect(f.requests.at(-1)).toEqual({ path: '/v1/data-bindings/request-ro/decision', body: { approve: true, decision: '仅用于排错' } });
  expect(page.text()).toContain('访问凭据已供给 · 接入待确认'); expect(page.text()).not.toContain('未提交的审批意见');
});

test('撤销具名对象，取消不写；只撤销目标绑定且保留另一类生产访问', async () => {
  const f = setup([record('ro', { state: 'active', expiresAt: '2099-01-01T00:00:00.000Z' }), record('rw', { mode: 'production-change', state: 'active', expiresAt: '2099-01-01T00:00:00.000Z' })]);
  page = await renderElement(<Harness />, messages); await openDetails(); await page.click('撤销绑定');
  expect(page.text()).toContain('撤销「生产数据只读」绑定（ro）'); await page.click('取消'); expect(f.requests).toHaveLength(0);
  await page.click('撤销绑定'); await page.click('确认撤销'); expect(f.requests).toEqual([{ path: '/v1/data-bindings/ro/revoke', body: undefined }]);
  expect(f.state.items.find((item) => item.id === 'rw')!.state).toBe('active'); expect(page.text()).toContain('已撤销');
  expect(productionAccessModes(f.state.items, Date.now())).toEqual(['production-change']);
});

test('旧记录期限缺失不可盲批、后台状态变化不可沿用旧确认，读失败不冒充有效授权或空记录', async () => {
  const f = setup([record('old', { ttlMinutes: undefined })]); page = await renderElement(<Harness />, messages); await openDetails();
  expect(page.button('批准').disabled).toBe(true); expect(page.text()).toContain('申请时长未确认'); expect(page.button('拒绝').disabled).toBe(false);
  f.state.items = [record('old')]; await page.click('刷新访问记录'); await page.click('批准'); await input(field('审批意见')!, '保留意见');
  f.state.items = [record('old', { state: 'rejected' })]; await page.click('刷新访问记录'); expect(page.button('确认批准').disabled).toBe(true); expect(page.text()).toContain('记录状态已经改变');
  f.state.failRead = true; await page.click('刷新访问记录'); expect(page.text()).toContain('访问状态未确认'); expect(page.text()).not.toContain('当前没有额外绑定记录'); expect(field('审批意见')!.value).toBe('保留意见');
  expect(f.requests).toHaveLength(0);
});

test('开发者可以申请但不审批；只读角色和未开通服务有明确原因，到期授权不进入生产摘要', async () => {
  setup([record('x')]); page = await renderElement(<Harness canManage={false} />, messages);
  expect(page.button('批准')).toBeUndefined(); expect(page.button('提交申请').disabled).toBe(false);
  page.unmount(); page = await renderElement(<Harness canDevelop={false} canManage={false} />, messages); expect(page.button('提交申请').disabled).toBe(true); expect(page.text()).toContain('申请需要项目开发权限');
  page.unmount(); page = await renderElement(<Harness service={null} />, messages); expect(page.button('提交申请').disabled).toBe(true); expect(page.text()).toContain('项目尚未完成开通');
  const expired = record('expired', { state: 'active', expiresAt: '2000-01-01T00:00:00.000Z' }); expect(bindingDisplayState(expired, Date.now())).toBe('expired'); expect(productionAccessModes([expired], Date.now())).toEqual([]);
});

test('同一项目更换开发任务时不沿用旧任务的绑定缓存或申请草稿', async () => {
  setup([record('previous-task-binding')]); const firstFetch = globalThis.fetch, nextTask = `tsk_${'e'.repeat(32)}`;
  let finish: () => void; const held = new Promise<void>((resolve) => { finish = resolve; });
  globalThis.fetch = (async (raw, init) => {
    if (String(raw).includes(`/tasks/${nextTask}/data-bindings`)) { await held; return new Response(JSON.stringify({ items: [record('new-task-binding', { taskId: nextTask as TaskDataBindingDto['taskId'] })] }), { headers: { 'content-type': 'application/json' } }); }
    return firstFetch(raw, init);
  }) as typeof fetch;
  function TaskSwitch() {
    const [task, setTask] = useState(taskId);
    const data = useDataBindings(projectId, task, serviceId, { canDevelop: true, canManage: true });
    return <><button onClick={() => setTask(nextTask)}>切换任务</button><DataBindingPane key={task} data={data} /></>;
  }
  page = await renderElement(<TaskSwitch />, messages); await input(field('申请理由')!, '上一个会话的输入');
  await page.click('切换任务'); expect(page.text()).not.toContain('previous-task-binding'); expect(field('申请理由')!.value).toBe(''); expect(page.button('提交申请').disabled).toBe(true);
  await act(async () => finish!()); await page.settle(); expect(page.text()).toContain('new-task-binding'); expect(page.button('提交申请').disabled).toBe(false);
});
