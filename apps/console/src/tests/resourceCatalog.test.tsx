import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { renderApp } from './renderApp';

const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });

function fixture() {
  const state = { readFailure: false, saveFailure: false, hold: undefined as Promise<void> | undefined, holdRead: undefined as Promise<void> | undefined,
    readOverride: undefined as unknown, writeOverride: undefined as Record<string, unknown> | undefined,
    service: { id: '01a0bf5d-8f4b-7000-9e4b-b54e91ee9d10', name: 'standard-small', cpu: '500m', memory: '512Mi', maxReplicas: 3, description: '原服务套餐' },
    task: { id: '01a0bf5d-8f4b-7816-8968-e71a4c0675bb', name: 'dev-standard', cpu: '1', memory: '2Gi', storage: '10Gi', description: '原任务套餐' } };
  const writes: Array<{ path: string; input: Record<string, unknown> }> = [];
  globalThis.fetch = (async (raw, init) => {
    const path = new URL(String(raw), 'http://localhost').pathname;
    if (path === '/v1/me') return Response.json({ id: '01a0bf5d-8f4b-7f8b-8136-e631380738b0', name: '管理员', email: 'admin@test.invalid', platformRole: 'admin', isAdmin: true, memberships: [] });
    if (!/\/catalog\/(service-plans|task-profiles)(?:\/[0-9a-f-]{36})?$/.test(path)) return Response.json({ items: [] });
    const kind = path.includes('/service-plans') ? 'service' : 'task';
    if (init?.method === 'PUT' || init?.method === 'POST') {
      const input = JSON.parse(String(init.body)) as Record<string, unknown>; writes.push({ path, input });
      if (state.hold) await state.hold;
      if (state.saveFailure) return Response.json({ error: 'unavailable', message: '套餐保存失败' }, { status: 503 });
      Object.assign(state[kind], input, init?.method === 'POST' ? { id: Bun.randomUUIDv7() } : {}); return Response.json({ ...state[kind], ...state.writeOverride });
    }
    if (state.holdRead) await state.holdRead;
    if (state.readOverride) return Response.json(state.readOverride);
    return state.readFailure ? Response.json({ error: 'unavailable', message: '套餐目录读取失败' }, { status: 503 }) : Response.json({ items: [state[kind]] });
  }) as typeof fetch;
  return { state, writes };
}
const field = (label: string) => [...document.querySelectorAll('label')].find((node) => node.querySelector('span')?.textContent === label)!.querySelector<HTMLInputElement>('input, textarea')!;
async function input(label: string, value: string) {
  const node = field(label);
  await act(async () => { node.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true })); }); await page!.settle();
}
async function edit(name: string) {
  const row = [...document.querySelectorAll('tr')].find((node) => node.textContent?.includes(name))!;
  const button = [...row.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent === '编辑')!;
  expect(button).toBeDefined(); await act(async () => { button.click(); }); await page!.settle();
}

test('套餐字段约束与全部错误首屏可定位；空表单 submit 不能通过旧 disabled 按钮旁路写入', async () => {
  const f = fixture(); page = await renderApp('/admin/service-plans');
  await act(async () => { document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); await page.settle();
  // 旧 AdminForm 只禁用按钮，没有字段校验；表单提交仍把空资源写进目录。
  expect(f.writes).toHaveLength(0); expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(3);
  expect(page.text()).toContain('1–80'); expect(page.text()).toContain('500m'); expect(document.activeElement === field('名称')).toBe(true);
  await input('名称', ' '.repeat(3)); await input('CPU', ' '); await input('内存', ' '); await input('最大副本', '1.5'); await page.click('检查并保存');
  expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(4); expect(f.writes).toHaveLength(0);
});

test('具名编辑与保存前对照当前值；取消不写入，覆盖后说明下次发布才生效', async () => {
  const f = fixture(); page = await renderApp('/admin/service-plans'); await edit('standard-small');
  expect(field('CPU').value).toBe('500m'); await input('CPU', '2'); await page.click('检查并保存');
  expect(page.text()).toContain('覆盖服务套餐 standard-small'); expect(page.text()).toContain('目录当前值'); expect(page.text()).toContain('本次保存值'); expect(f.writes).toHaveLength(0);
  await page.click('继续编辑'); expect(field('CPU').value).toBe('2'); await page.click('检查并保存'); await page.click('确认覆盖');
  expect(f.writes[0]?.input).toEqual({ name: 'standard-small', cpu: '2', memory: '512Mi', maxReplicas: 3, description: '原服务套餐' });
  expect(page.text()).toContain('已保存服务套餐 standard-small'); expect(page.text()).toContain('下次发布');
  await page.navigate('/admin'); expect(page.path()).toBe('/admin');
});

test('套餐读取失败保留输入并暂停保存；目录变化先更新确认材料，再次确认才覆盖', async () => {
  const f = fixture(); page = await renderApp('/admin/service-plans'); await edit('standard-small'); await input('内存', '4Gi');
  f.state.readFailure = true; await page.click('检查并保存'); expect(page.text()).toContain('套餐目录读取失败'); expect(field('内存').value).toBe('4Gi'); expect(f.writes).toHaveLength(0);
  f.state.readFailure = false; await page.reread(); await page.click('检查并保存');
  f.state.service.cpu = '1500m'; await page.click('确认覆盖');
  expect(f.writes).toHaveLength(0); expect(page.text()).toContain('目录已变化'); expect(page.text()).toContain('1500m');
  await page.click('确认覆盖'); expect(f.writes[0]?.input.cpu).toBe('500m'); expect(f.writes[0]?.input.memory).toBe('4Gi');
});

test('套餐失败、换编辑对象和新建都保留草稿，放弃只替换表单且不会偷偷写入', async () => {
  const f = fixture(); page = await renderApp('/admin/service-plans'); await edit('standard-small'); await input('CPU', '3');
  await edit('standard-small'); expect(field('CPU').value).toBe('3'); await page.click('继续编辑');
  await page.click('新建服务套餐'); expect(field('CPU').value).toBe('3'); await page.click('继续编辑');
  f.state.saveFailure = true; await page.click('检查并保存'); await page.click('确认覆盖'); expect(page.text()).toContain('套餐保存失败'); expect(field('CPU').value).toBe('3');
  await page.click('继续编辑'); await page.requestNavigate('/admin'); expect(page.path()).toBe('/admin/projects/resource-templates'); await page.click('继续编辑');
  await page.click('新建服务套餐'); await page.click('放弃输入并载入'); expect(field('名称').value).toBe(''); expect(f.writes).toHaveLength(1);
});

test('任务套餐保留 CPU、内存和存储，明确新增与覆盖，保存后已有任务保持原规格', async () => {
  const f = fixture(); page = await renderApp('/admin/task-profiles');
  await input('名称', 'dev-large'); await input('CPU', '4'); await input('内存', '8Gi'); await input('存储', '40Gi'); await input('说明', '大任务');
  await page.click('检查并保存'); expect(page.text()).toContain('新增任务容器套餐 dev-large'); await page.click('确认新增');
  expect(f.writes[0]).toEqual({ path: '/v1/catalog/task-profiles', input: { name: 'dev-large', cpu: '4', memory: '8Gi', storage: '40Gi', description: '大任务' } });
  expect(page.text()).toContain('运行中的任务不受影响'); await page.navigate('/admin'); expect(page.path()).toBe('/admin');
});

test('套餐在途操作互斥、表单锁定；确认离开后迟到成功不改变当前位置', async () => {
  const f = fixture(); let finish!: () => void; f.state.hold = new Promise<void>((resolve) => { finish = resolve; });
  page = await renderApp('/admin/service-plans'); await edit('standard-small'); await input('CPU', '4'); await page.click('检查并保存');
  await page.click('确认覆盖'); await page.click('确认覆盖'); expect(f.writes).toHaveLength(1); expect(field('CPU').disabled).toBe(true);
  await page.requestNavigate('/admin'); expect(page.path()).toBe('/admin/projects/resource-templates'); await page.click('放弃输入并离开');
  await act(async () => { finish(); }); await page.settle(); expect(page.path()).toBe('/admin'); expect(f.writes).toHaveLength(1);
});

test('目录与保存回执无效时不显示空目录或假成功，保存后的查询失败与写入结果分开', async () => {
  const f = fixture(); page = await renderApp('/admin/service-plans'); await edit('standard-small'); await input('CPU', '2');
  f.state.readOverride = { items: [{ name: 'broken' }] }; await page.reread();
  expect(page.text()).toContain('套餐目录格式无法确认'); expect(page.text()).not.toContain('还没有服务套餐'); expect(field('CPU').value).toBe('2');
  f.state.readOverride = undefined; await page.reread(); await page.click('检查并保存');
  f.state.writeOverride = { name: 'different-name' }; await page.click('确认覆盖');
  expect(page.text()).toContain('保存回执无法与本次输入对应'); expect(page.text()).not.toContain('已保存服务套餐'); expect(field('CPU').value).toBe('2');
  await page.click('继续编辑'); f.state.writeOverride = undefined; await page.reread(); await page.click('检查并保存');
  let finish!: () => void; f.state.hold = new Promise<void>((resolve) => { finish = resolve; }); await page.click('确认覆盖');
  f.state.readFailure = true; await act(async () => { finish(); }); await page.settle();
  expect(page.text()).toContain('已保存服务套餐 standard-small'); expect(page.text()).toContain('套餐目录读取失败'); expect(f.writes).toHaveLength(2);
  await page.navigate('/admin'); expect(page.path()).toBe('/admin');
});

test('确认前的目录读取仍在途时离开，迟到读取不再发起保存', async () => {
  const f = fixture(); page = await renderApp('/admin/service-plans'); await edit('standard-small'); await input('CPU', '3'); await page.click('检查并保存');
  let finish!: () => void; f.state.holdRead = new Promise<void>((resolve) => { finish = resolve; }); await page.click('确认覆盖');
  await page.requestNavigate('/admin'); await page.click('放弃输入并离开');
  await act(async () => { finish(); }); await page.settle(); expect(f.writes).toHaveLength(0); expect(page.path()).toBe('/admin');
});
