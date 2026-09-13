import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { renderApp } from './renderApp';

const originalFetch = globalThis.fetch, projectId = `prj_${'a'.repeat(32)}`, serviceId = `svc_${'b'.repeat(32)}`, ownerId = `usr_${'c'.repeat(32)}`, memberId = `usr_${'d'.repeat(32)}`;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });

function fixture() {
  const state = { admin: false, role: 'owner', projectState: 'active', failIdentity: false, failLookup: false, noMatch: false, failRead: false, failWrite: false, hold: undefined as Promise<void> | undefined };
  const member = { userId: memberId, name: '小林', email: 'lin@test.invalid', role: 'developer' };
  const calls: Array<{ url: URL; method: string; body?: Record<string, unknown> }> = [];
  globalThis.fetch = (async (raw, init) => {
    const url = new URL(String(raw), 'http://localhost'), method = init?.method ?? 'GET', input = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    calls.push({ url, method, body: input }); let status = 200, body: unknown = { items: [] };
    if (method !== 'GET') {
      if (state.hold) await state.hold;
      if (state.failWrite) { status = 503; body = { error: 'unavailable', message: '成员写入暂不可用' }; }
      else if (method === 'DELETE') return new Response(null, { status: 204 });
      else if (url.pathname.endsWith('/archive')) { state.projectState = 'archived'; body = { state: 'archived' }; }
      else { member.role = String(input?.role); body = { ...member, userId: input?.userId }; }
    } else if (url.pathname === '/v1/me') {
      if (state.failIdentity) { status = 503; body = { error: 'unavailable', message: '当前身份读取失败' }; }
      else body = { id: ownerId, name: '负责人甲', email: 'owner@test.invalid', isAdmin: state.admin, memberships: [{ projectId, role: state.role }] };
    }
    else if (url.pathname.startsWith('/v1/projects/') && !url.pathname.slice(13).includes('/')) body = { id: url.pathname.split('/').at(-1), serviceId, slug: 'demo', name: '演示应用', kind: 'DigitalWorker', ownerUserId: ownerId, state: state.projectState };
    else if (url.pathname === '/v1/users') body = { items: [{ id: memberId, name: member.name, email: member.email }] };
    else if (url.pathname.endsWith('/member-candidates')) {
      if (state.failLookup) { status = 503; body = { error: 'unavailable', message: '账号目录暂不可用' }; }
      else body = { items: state.noMatch ? [] : [{ userId: memberId, name: member.name, email: member.email }] };
    } else if (url.pathname.endsWith('/members')) {
      if (state.failRead) { status = 503; body = { error: 'unavailable', message: '成员读取失败' }; }
      else body = { items: [{ userId: ownerId, name: '负责人甲', email: 'owner@test.invalid', role: 'owner' }, member] };
    } else if (url.pathname.endsWith('/dev-session')) { status = 404; body = { error: 'not_found', message: '无会话' }; }
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { state, calls, writes: () => calls.filter((call) => call.method !== 'GET') };
}

async function input(node: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(async () => { node.focus(); const proto = node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(node, value); node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); node.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true })); });
  await page!.settle();
}
const field = (name: string) => [...document.querySelectorAll<HTMLLabelElement>('label')].find((label) => !label.closest('[hidden]') && label.querySelector('span')?.textContent === name)!.querySelector<HTMLInputElement>('input')!;
const role = () => document.querySelector<HTMLSelectElement>('select[aria-label="成员角色"]')!;
async function selectMember() { await input(field('完整邮箱或用户 ID'), 'lin@test.invalid'); await page!.click('查找账号'); await page!.click('选择此成员'); }

test('移除先显示具体成员和后果，取消不写入；当前负责人不提供移除入口', async () => {
  const f = fixture(); page = await renderApp(`/projects/${projectId}/settings?tab=members`);
  const ownerRow = [...document.querySelectorAll('tr')].find((row) => row.textContent?.includes('负责人甲'))!;
  await page.click('移除');
  // 原来行上的移除按钮直接 DELETE，用户看不到目标确认也没有取消机会。
  expect(f.writes()).toHaveLength(0); expect(page.text()).toContain('移除小林'); expect(page.text()).toContain('失去此项目成员角色');
  expect(ownerRow.querySelector('button')).toBeNull(); await page.click('取消'); expect(f.writes()).toHaveLength(0);
  await page.click('移除'); await page.click('确认移除'); expect(f.writes()[0]?.url.pathname).toBe(`/v1/projects/${projectId}/members/${memberId}`);
});

test('负责人精确查找，目录失败与无匹配分开；赋角色失败保留身份和选择', async () => {
  const f = fixture(); f.state.failLookup = true; page = await renderApp(`/projects/${projectId}/settings?tab=members`);
  expect(page.text()).toContain('最多 254 字'); expect(page.text()).toContain('负责人只能由管理员转移');
  await page.click('添加或改角色'); expect(field('完整邮箱或用户 ID').getAttribute('aria-invalid')).toBe('true'); expect(f.writes()).toHaveLength(0);
  await input(field('完整邮箱或用户 ID'), 'lin@test.invalid'); await page.click('查找账号');
  expect(field('完整邮箱或用户 ID').value).toBe('lin@test.invalid'); expect(page.text()).toContain('账号目录暂不可用'); expect(page.text()).not.toContain('没有唯一匹配账号');
  f.state.failLookup = false; f.state.noMatch = true; await page.click('查找账号'); expect(page.text()).toContain('没有唯一匹配账号');
  f.state.noMatch = false; await page.click('查找账号'); await page.click('选择此成员');
  expect(page.text()).toContain('已选择 小林（lin@test.invalid）');
  expect(role().querySelector<HTMLOptionElement>('option[value="owner"]')!.disabled).toBe(true);
  await input(role(), 'tester'); expect(page.text()).toContain('可访问 preview 进行验证');
  f.state.failWrite = true; await page.click('添加或改角色');
  expect(page.text()).toContain('成员写入暂不可用'); expect(page.text()).toContain('已选择 小林'); expect(role().value).toBe('tester');
  f.state.failWrite = false; await page.click('添加或改角色'); expect(page.text()).toContain('已将小林保存为preview 测试者');
  expect(f.writes().at(-1)?.body).toEqual({ userId: memberId, role: 'tester' });
  expect(f.calls.some((call) => call.url.pathname === '/v1/users')).toBe(false);
  expect(f.calls.find((call) => call.url.pathname.endsWith('/member-candidates'))?.url.searchParams.get('identity')).toBe('lin@test.invalid');
});

test('高级 ID 保留有效直输能力，首屏格式约束、字段错误和焦点；失败草稿不进入另一项目', async () => {
  const f = fixture(); page = await renderApp(`/projects/${projectId}/settings?tab=members`);
  await page.click('高级：用户 ID'); expect(page.text()).toContain('32 位小写十六进制');
  const id = field('用户 ID'); await input(id, 'usr_bad'); await page.click('添加或改角色');
  expect(id.getAttribute('aria-invalid')).toBe('true'); expect(document.activeElement === id).toBe(true); expect(f.writes()).toHaveLength(0);
  f.state.failWrite = true; await input(id, memberId); await page.click('添加或改角色');
  expect(f.writes()[0]?.body).toEqual({ userId: memberId, role: 'developer' }); expect(id.value).toBe(memberId);
  expect(f.calls.some((call) => call.url.pathname.endsWith('/member-candidates'))).toBe(false);
  await page.requestNavigate(`/projects/prj_${'e'.repeat(32)}/settings?tab=members`);
  expect(page.path()).toBe(`/projects/${projectId}/settings`); await page.click('放弃输入并离开');
  expect(document.querySelector<HTMLInputElement>('input')?.value).not.toBe(memberId); expect(page.text()).not.toContain('成员写入暂不可用');
});

test('管理员仍可从用户目录选择；负责人转移确认包括旧负责人降为开发者，取消和失败保留', async () => {
  const f = fixture(); f.state.admin = true; page = await renderApp(`/projects/${projectId}/settings?tab=members`);
  await page.click('管理员用户目录');
  const directory = [...document.querySelectorAll('label')].find((label) => label.querySelector('span')?.textContent === '用户')!.querySelector('select')!;
  await input(directory, memberId); await input(role(), 'owner'); await page.click('添加或改角色');
  expect(page.text()).toContain('将负责人从负责人甲转移给小林'); expect(page.text()).toContain('原负责人将变为开发者'); expect(f.writes()).toHaveLength(0);
  await page.click('取消'); expect(role().value).toBe('owner'); expect(f.writes()).toHaveLength(0);
  await page.click('添加或改角色'); f.state.failWrite = true; await page.click('确认转移负责人');
  expect(page.text()).toContain('成员写入暂不可用'); expect(page.text()).toContain('将负责人从负责人甲转移给小林');
  f.state.failWrite = false; await page.click('确认转移负责人'); expect(f.writes().at(-1)?.body).toEqual({ userId: memberId, role: 'owner' });
  expect(page.text()).toContain('已将小林保存为项目负责人'); expect(f.calls.filter((call) => call.url.pathname === '/v1/me').length).toBeGreaterThan(1);
});

test('在途请求锁住身份、角色和全部成员变更；读取失败保留输入并阻止确认，恢复可继续', async () => {
  const f = fixture(); page = await renderApp(`/projects/${projectId}/settings?tab=members`); await selectMember();
  let finish!: () => void; f.state.hold = new Promise<void>((resolve) => { finish = resolve; });
  await page.click('移除'); await page.click('添加或改角色'); await page.click('确认移除'); await page.click('保存中'); await page.click('更换成员');
  expect(f.writes()).toHaveLength(1); expect(role().disabled).toBe(true); expect(page.text()).toContain('已选择 小林');
  await act(async () => { finish(); }); await page.settle(); f.state.hold = undefined;
  await page.click('取消'); await selectMember(); f.state.failRead = true; await page.click('刷新成员');
  expect(page.text()).toContain('成员读取失败'); expect(page.text()).toContain('已选择 小林');
  await page.click('添加或改角色'); expect(f.writes()).toHaveLength(1); expect(role().disabled).toBe(true);
  f.state.failRead = false; await page.click('刷新成员'); expect(role().disabled).toBe(false);
  await page.click('添加或改角色'); expect(f.writes()).toHaveLength(2);
});

test('普通开发者查看成员说明，不加载目录或显示成员写操作', async () => {
  const f = fixture(); f.state.role = 'developer'; page = await renderApp(`/projects/${projectId}/settings?tab=members`);
  expect(page.text()).toContain('成员设置由负责人或管理员维护'); expect(page.text()).not.toContain('添加或改角色');
  expect([...document.querySelectorAll('button')].some((button) => button.textContent === '移除')).toBe(false);
  expect(f.calls.some((call) => call.url.pathname === '/v1/users')).toBe(false); expect(f.writes()).toHaveLength(0);
});

test('生命周期只给管理员既有归档操作，明确资源保留、异步效果、对象与取消，失败可重试', async () => {
  const f = fixture(); page = await renderApp(`/projects/${projectId}/settings?tab=lifecycle`);
  expect(page.text()).toContain('只有管理员可以归档项目'); expect(page.text()).toContain('不会释放已有开发会话');
  expect(page.text()).toContain('源码仓库、数据库与文件保留'); expect(page.text()).not.toContain('确认归档此项目');
  page.unmount(); f.state.admin = true; page = await renderApp(`/projects/${projectId}/settings?tab=lifecycle`);
  await page.click('归档项目'); expect(page.text()).toContain('归档演示应用（demo）'); expect(f.writes()).toHaveLength(0);
  await page.click('取消'); expect(f.writes()).toHaveLength(0);
  f.state.failWrite = true; await page.click('归档项目'); await page.click('确认归档此项目'); expect(page.text()).toContain('归档失败');
  f.state.failWrite = false; await page.click('归档项目'); await page.click('确认归档此项目');
  expect(f.writes().at(-1)?.url.pathname).toBe(`/v1/projects/${projectId}/archive`); expect(f.writes().at(-1)?.method).toBe('POST');
  expect(page.text()).toContain('服务器已返回项目状态：已归档'); expect(page.text()).toContain('不表示容器或数据已删除');
});

test('开通中和已归档项目不提供无效的重复归档动作', async () => {
  const f = fixture(); f.state.admin = true; f.state.projectState = 'provisioning'; page = await renderApp(`/projects/${projectId}/settings?tab=lifecycle`);
  expect(page.text()).toContain('开通中的项目暂不能归档'); expect([...document.querySelectorAll('button')].some((button) => button.textContent === '归档项目')).toBe(false);
  page.unmount(); f.state.projectState = 'archived'; page = await renderApp(`/projects/${projectId}/settings?tab=lifecycle`);
  expect(page.text()).toContain('项目已归档'); expect([...document.querySelectorAll('button')].some((button) => button.textContent === '归档项目')).toBe(false); expect(f.writes()).toHaveLength(0);
});

test('成员草稿：查找与 ID 切换保留各自输入，隐藏的 ID 不作为当前查找目标提交', async () => {
  const f = fixture(); page = await renderApp(`/projects/${projectId}/settings?tab=members`);
  await input(field('完整邮箱或用户 ID'), 'lin@test.invalid'); await page.click('高级：用户 ID'); await input(field('用户 ID'), memberId);
  await page.click('按账号查找');
  // 原 picker 切模式清掉 rawId，且重新挂载查找输入；保留输入后还必须限定当前提交方式。
  expect(field('完整邮箱或用户 ID').value).toBe('lin@test.invalid');
  await page.click('添加或改角色'); expect(f.writes()).toHaveLength(0); expect(field('完整邮箱或用户 ID').getAttribute('aria-invalid')).toBe('true');
  await page.click('高级：用户 ID'); expect(field('用户 ID').value).toBe(memberId); await input(role(), 'tester');
  await page.click('添加或改角色'); expect(f.writes()[0]?.body).toEqual({ userId: memberId, role: 'tester' });
  await page.click('仓库'); expect(page.search().tab).toBe('repository');
});

test('成员草稿：未完成查找和已选角色都保护离开，取消导航无写入，保存后可正常离开', async () => {
  const f = fixture(); page = await renderApp(`/projects/${projectId}/settings?tab=members`);
  await input(field('完整邮箱或用户 ID'), 'lin@'); await page.click('仓库');
  expect(page.search().tab).toBe('members'); await page.click('继续编辑'); expect(field('完整邮箱或用户 ID').value).toBe('lin@');
  await selectMember(); await input(role(), 'tester'); await page.requestNavigate('/projects');
  expect(page.path()).toContain('/settings'); expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(1); await page.click('继续编辑');
  expect(role().value).toBe('tester'); expect(f.writes()).toHaveLength(0);
  await page.click('添加或改角色'); await page.click('仓库'); expect(page.search().tab).toBe('repository');
});

test('成员草稿：身份读取失败或角色撤销后保留目标和角色，暂停变更，恢复后再显式保存', async () => {
  const f = fixture(); page = await renderApp(`/projects/${projectId}/settings?tab=members`); await selectMember(); await input(role(), 'tester');
  f.state.failIdentity = true; await page.click('刷新成员');
  expect(page.text()).toContain('当前身份读取失败'); expect(role().disabled).toBe(true); expect(role().value).toBe('tester'); expect(page.text()).toContain('已选择 小林');
  await act(async () => { role().closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); await page.settle(); expect(f.writes()).toHaveLength(0);
  f.state.failIdentity = false; f.state.role = 'developer'; await page.click('刷新成员');
  expect(role().value).toBe('tester'); expect(role().disabled).toBe(true); await page.click('仓库'); expect(page.search().tab).toBe('members'); await page.click('继续编辑');
  f.state.role = 'owner'; await page.click('刷新成员'); expect(role().disabled).toBe(false); expect(f.writes()).toHaveLength(0);
  await page.click('添加或改角色'); expect(f.writes()[0]?.body).toEqual({ userId: memberId, role: 'tester' });
});

test('成员草稿：在途保存保护离开，重复 submit 不增加写入，确认离开后的成功不拉回', async () => {
  const f = fixture(); let finish!: () => void; f.state.hold = new Promise<void>((resolve) => { finish = resolve; });
  page = await renderApp(`/projects/${projectId}/settings?tab=members`); await selectMember();
  await act(async () => { for (let i = 0; i < 2; i++) role().closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); await page.settle();
  expect(f.writes()).toHaveLength(1); expect(page.text()).toContain('离开不会撤销已发送的成员变更');
  await page.requestNavigate('/projects'); expect(page.path()).toContain('/settings'); await page.click('继续编辑'); expect(page.text()).toContain('已选择 小林');
  await page.requestNavigate('/projects'); await page.click('放弃输入并离开');
  await act(async () => { finish(); }); await page.settle(); expect(page.path()).toBe('/projects'); expect(f.writes()).toHaveLength(1);
});

test('成员草稿：转移确认期间失去管理员身份仍保留材料，但负责人角色本身不足以继续转移', async () => {
  const f = fixture(); f.state.admin = true; page = await renderApp(`/projects/${projectId}/settings?tab=members`);
  await selectMember(); await input(role(), 'owner'); await page.click('添加或改角色');
  f.state.admin = false; await page.click('刷新成员');
  expect(page.text()).toContain('将负责人从负责人甲转移给小林');
  // 旧确认只检查可管理成员；管理员降为项目负责人后仍显示可提交的转移按钮。
  const confirm = [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '确认转移负责人')!;
  expect(confirm.disabled).toBe(true); await page.click('确认转移负责人'); expect(f.writes()).toHaveLength(0);
  f.state.admin = true; await page.click('刷新成员'); await page.click('确认转移负责人');
  expect(f.writes()[0]?.body).toEqual({ userId: memberId, role: 'owner' });
});
