import './domSetup';
import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { ReleaseId, TaskId } from '@crewstation/contracts';
import { renderApp } from './renderApp';
import { summaryFixture, summaryUserId } from './projectSummaryFixture';

const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });
async function enter(label: string, value: string) {
  const node = document.querySelector(`[aria-label="${label}"]`) as HTMLInputElement | HTMLSelectElement;
  if (!node) throw new Error(`missing field ${label}`);
  await act(async () => {
    node.focus();
    const prototype = node.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event(node.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    node.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
  }); await page!.settle();
}

test.each(['DigitalWorker', 'APIProxy'] as const)('%s 概览一屏：页头一行仓库与地址链接保留项目与空间，没有重复左栏的快捷入口卡', async (kind) => {
  const f = summaryFixture(), time = new Date().toISOString(); f.item.project.kind = kind;
  f.item.slots = { status: 'ready', checkedAt: time, value: [
    { name: 'prod', active: true, tag: 'v1.0.0', commitSha: 'a'.repeat(40), releaseId: '01a0bf5d-8f4b-7574-87e3-e3a9645702f6' as ReleaseId, host: 'formal.test', state: 'ready', replicas: 1, readyReplicas: 1 },
    { name: 'preview', active: false, state: 'deploying', host: 'trial.test', replicas: 1, readyReplicas: 0 },
  ] };
  const base = `${kind === 'DigitalWorker' ? '/projects' : '/admin/integrations'}/${f.item.project.id}`;
  page = await renderApp(base);
  // RFC-020 D4：快捷入口卡（左栏的重复）删除；地址只在实际就绪时是链接，未就绪的槽只显示域名。
  expect(document.querySelector('main nav[aria-label="项目快捷入口"]')).toBeNull();
  const header = document.querySelector('main header')!;
  expect(header.querySelector('a[href="//formal.test"]')?.textContent).toBe('formal.test ↗');
  expect(header.querySelector('a[href="//trial.test"]')).toBeNull(); expect(header.textContent).toContain('trial.test');
  const info = header.querySelector<HTMLAnchorElement>('a[href*="tab=info"]')!;
  expect(info.textContent).toBe('项目信息'); expect(info.getAttribute('href')).toBe(`${base}/settings?tab=info`);
  await act(async () => info.click()); await page.settle();
  expect(page.path()).toBe(`${base}/settings`); expect(page.search().tab).toBe('info');
  expect(f.writes).toEqual([]);
});

describe('项目列表的真实分页与独立状态', () => {
  test('回到前台重读当前身份与摘要，保留尚未应用的搜索输入；离开后不继续读取', async () => {
    const f = summaryFixture(); let visible = true;
    const original = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visible ? 'visible' : 'hidden' });
    const reads = () => f.calls.filter((url) => url.startsWith('/v1/workbench/project-summaries')).length;
    const visibility = async (next: boolean) => { visible = next; await act(async () => { document.dispatchEvent(new Event('visibilitychange')); }); await page!.settle(); };
    try {
      page = await renderApp('/projects'); await enter('搜索名称或标识', '未提交的搜索'); const before = reads();
      await visibility(false); expect(reads()).toBe(before); f.item.project.name = '后台已更新';
      await visibility(true); expect(reads()).toBe(before + 1); expect(page.text()).toContain('后台已更新');
      expect((document.querySelector('[aria-label="搜索名称或标识"]') as HTMLInputElement).value).toBe('未提交的搜索');
      expect(page.search().q).toBe(''); page.unmount(); const stopped = reads();
      await visibility(false); await visibility(true); expect(reads()).toBe(stopped); page = undefined;
    } finally { if (original) Object.defineProperty(document, 'visibilityState', original); else Reflect.deleteProperty(document, 'visibilityState'); }
  });
  test('身份初始读取失败不能被未启动的摘要请求遮成无限加载或零项', async () => {
    const f = summaryFixture(); f.meError = true; page = await renderApp('/projects');
    expect(page.text()).toContain('身份读取失败'); expect(page.text()).not.toContain('加载项目…'); expect(page.text()).not.toContain('本页 0 项');
    expect(f.calls.some((url) => url.startsWith('/v1/workbench/project-summaries'))).toBe(false);
    f.meError = false; await page.click('重新检查权限'); expect(page.text()).toContain('数字助手 1');
  });
  test('紧凑列表只请求当前摘要页，基本信息可展开，未知健康不显示正常', async () => {
    const f = summaryFixture(); page = await renderApp('/projects');
    expect(page.text()).toContain('数字助手 1'); expect(page.text()).toContain('尚无开发会话'); expect(page.text()).toContain('健康状态暂不可用');
    expect(page.text()).toContain('已开通'); expect(page.text()).not.toContain('正常'); expect(page.text()).toContain('王负责人');
    expect(document.querySelector('table details')?.textContent).toContain('cs-demo-1');
    expect(f.calls.filter((url) => url.startsWith('/v1/workbench/project-summaries'))).toHaveLength(1);
    expect(f.calls.some((url) => url === '/v1/projects' || url.startsWith('/v1/projects?') || /\/services\/|\/dev-session|\/health/.test(url))).toBe(false);
    await page.click('下一页'); expect(page.text()).toContain('数字助手 2'); expect(page.text()).not.toContain('数字助手 1');
    expect(page.search().cursor).toBe('next-page'); await page.back(); expect(page.text()).toContain('数字助手 1');
  });
  // 2026-09-23 实撞：RFC-020 把这两个入口的文案挪到 slot.open.* 后，列表还在用已删掉的旧键，页面上直接显示键名。
  test('列表里的访问入口是按钮样式的外部链接，文案来自槽位共用的 slot.open.*', async () => {
    const f = summaryFixture();
    f.item.slots = { status: 'ready', checkedAt: f.item.checkedAt, value: [{ name: 'prod', active: true, tag: 'v1.0.0', commitSha: 'a'.repeat(40), releaseId: '01a0bf5d-8f4b-7574-87e3-e3a9645702f6' as ReleaseId, host: 'formal.test', state: 'ready', replicas: 1, readyReplicas: 1 }] };
    page = await renderApp('/projects');
    const open = document.querySelector('table a[href="//formal.test"]');
    expect(open?.textContent).toBe('打开正式应用'); expect(open?.getAttribute('target')).toBe('_blank'); expect(open?.hasAttribute('data-button')).toBe(true);
    expect(page.text()).not.toContain('projects.summary.');
  });
  test('名称／标识、状态和负责人筛选进入 URL，切条件清游标，浏览器返回恢复实际范围', async () => {
    const f = summaryFixture(); page = await renderApp('/projects?cursor=next-page');
    await enter('搜索名称或标识', '报表'); await enter('开通状态', 'failed'); await enter('负责人', summaryUserId);
    await page.click('查询项目'); expect(page.search()).toMatchObject({ q: '报表', state: 'failed', ownerUserId: summaryUserId }); expect(page.search().cursor).toBeUndefined();
    const query = new URL(f.calls.filter((c) => c.startsWith('/v1/workbench/project-summaries')).at(-1)!, 'http://test').searchParams;
    expect(query.get('q')).toBe('报表'); expect(query.get('state')).toBe('failed'); expect(query.get('ownerUserId')).toBe(summaryUserId); expect(query.get('kind')).toBe('DigitalWorker'); expect(query.get('limit')).toBe('20');
    await page.click('清除条件'); expect(page.search().q ?? '').toBe(''); await page.back(); expect(page.search().q).toBe('报表');
    expect((document.querySelector('[aria-label="搜索名称或标识"]') as HTMLInputElement).value).toBe('报表');
  });
  test('初始加载、失败与无项目／无筛选结果分别显示，非法回执不变为空列表', async () => {
    const f = summaryFixture(); f.hang = true; page = await renderApp('/projects');
    expect(page.text()).toContain('加载项目'); expect(page.text()).not.toContain('尚无项目'); page.unmount(); page = undefined;
    f.hang = false; f.empty = true; page = await renderApp('/projects'); expect(page.text()).toContain('尚无项目'); expect(page.text()).toContain('新建项目');
    await page.navigate('/projects?q=不存在'); expect(page.text()).toContain('没有符合条件的项目'); expect(page.text()).not.toContain('尚无项目');
    f.error = true; await page.click('刷新项目'); expect(page.text()).toContain('摘要读取失败'); expect(page.text()).not.toContain('没有符合条件');
    f.error = false; f.invalid = true; await page.click('刷新项目'); expect(page.text()).toContain('项目摘要格式无法确认'); expect(page.text()).not.toContain('尚无项目');
    f.invalid = false; f.empty = false; await page.click('刷新项目'); expect(page.text()).toContain('数字助手 1');
  });
  test('过期记录明确提示，读取失败后不保留可打开的旧试用地址，测试者无开发动作', async () => {
    const f = summaryFixture(); f.item.checkedAt = f.item.slots.checkedAt = '2020-01-01T00:00:00.000Z'; page = await renderApp('/projects');
    expect(page.text()).toContain('记录已过期'); expect(page.text()).not.toContain('打开试用');
    f.item = { ...f.item, role: 'tester' }; f.admin = false; f.item.development = { status: 'restricted', checkedAt: new Date().toISOString() };
    await page.click('刷新项目'); expect(page.text()).toContain('preview 测试者'); expect(page.text()).not.toContain('开始开发'); expect(page.text()).not.toContain('继续开发');
  });
});

test.each(['列表', '概览'])('%s 的会话分支明确标为创建时记录，缺失保持未知且不额外查询工作树', async (view) => {
  const f = summaryFixture(), time = new Date().toISOString();
  const session = { taskId: '01a0bf5d-8f4b-7e52-8b45-4a547fd10e4f' as TaskId, state: 'running' as const, connected: true, branch: 'main', createdAt: time, lastActivityAt: time };
  f.item.development = { status: 'ready', checkedAt: time, value: session };
  page = await renderApp(view === '列表' ? '/projects' : `/projects/${f.item.project.id}`);
  const branch = [...document.querySelectorAll('code')].find((node) => node.textContent === 'main')!;
  // 实机已切到 codex/rfc003-files，摘要仍显示创建时 main；不能把元数据冒充当前工作树。列表写明「创建时分支」，概览的会话卡只放分支名。
  expect(branch.parentElement?.textContent).toBe(view === '列表' ? '创建时分支：main' : 'main · 0 个 CLI');
  f.item.development.value = { ...session, branch: undefined };
  await page.click(view === '列表' ? '刷新项目' : '刷新');
  expect(page.text()).toContain(view === '列表' ? '创建时分支：分支未知' : '分支未知');
  // 列表不为分支文字追加容器工作树请求；概览的会话卡按 RFC-020 §4.2 读一次版本比较拿待上线与未提交数，但仍不读工作树状态。
  expect(f.calls.some((url) => url.includes('workspace-status'))).toBe(false);
  expect(f.calls.some((url) => url.includes('version-comparison'))).toBe(view === '概览');
  if (view === '列表') expect(f.calls.some((url) => /\/dev-session|\/tasks\//.test(url))).toBe(false);
  expect(f.writes).toEqual([]);
});

describe('概览按实际状态选择下一步', () => {
  test('两个访问入口只指向实际就绪主机，降级与读取失败不沿用旧链接，诊断保留项目上下文', async () => {
    const f = summaryFixture(), time = new Date().toISOString();
    f.item.slots = { status: 'ready', checkedAt: time, value: [
      { name: 'prod', active: true, tag: 'v1.0.0', commitSha: 'a'.repeat(40), releaseId: '01a0bf5d-8f4b-7574-87e3-e3a9645702f6' as ReleaseId, host: 'formal.test', state: 'ready', replicas: 1, readyReplicas: 1 },
      { name: 'preview', active: false, tag: 'v1.0.1', commitSha: 'b'.repeat(40), releaseId: '01a0bf5d-8f4b-7645-8cca-c128d59001d1' as ReleaseId, host: 'trial.test', state: 'ready', replicas: 1, readyReplicas: 1 },
    ] };
    page = await renderApp(`/projects/${f.item.project.id}`);
    const openLinks = () => [...document.querySelectorAll('a[href="//formal.test"], a[href="//trial.test"]')].map((node) => node.textContent);
    expect(openLinks()).toEqual(['formal.test ↗', 'trial.test ↗', '打开正式应用', '打开试用']); expect(page.text()).toContain('共享生产数据');
    expect(page.text()).toContain('运行健康需要确认'); expect(document.querySelector('a[href*="operations?tab=status"]')).not.toBeNull();
    f.item.slots.value[0]!.state = 'degraded'; await page.click('刷新'); expect(document.querySelector('a[href="//formal.test"]')).toBeNull();
    f.error = true; await page.click('刷新'); expect(document.querySelector('a[href="//trial.test"]')).toBeNull(); expect(page.text()).toContain('上次读取的记录');
    expect(document.querySelector('[data-primary-project-action]')).toBeNull();
  });
  test('开通失败给管理员或负责人具名恢复入口，普通开发成员只能联系管理员', async () => {
    const f = summaryFixture(); f.item.role = 'admin'; f.item.project.state = 'failed'; f.item.project.message = '模板缺少配置';
    page = await renderApp(`/projects/${f.item.project.id}`); expect(page.text()).toContain('模板缺少配置');
    const action = document.querySelector('[data-primary-project-action]') as HTMLAnchorElement;
    expect(action.textContent).toContain('查看开通问题'); expect(action.getAttribute('href')).toContain(`/admin/projects/${f.item.project.id}/provisioning`);
    f.admin = false; f.item.role = 'owner'; await page.click('刷新');
    expect(document.querySelector('[data-primary-project-action]')?.getAttribute('href')).toBe(`/projects/${f.item.project.id}/provisioning`);
    f.item.role = 'developer'; await page.click('刷新'); expect(document.querySelector('[data-primary-project-action]')).toBeNull(); expect(page.text()).toContain('联系管理员处理开通问题');
  });
  test('最新发布失败直达该发布，次动作继续开发；没有会话时开始开发只导航', async () => {
    const f = summaryFixture(), time = new Date().toISOString();
    f.item.releases = { status: 'ready', checkedAt: time, value: [{ id: '01a0bf5d-8f4b-7645-8cca-c128d59001d1' as ReleaseId, serviceId: f.item.project.serviceId!,
      tag: 'v1.0.2', commitSha: 'b'.repeat(40), branch: 'main', status: 'failed', createdBy: summaryUserId, createdAt: time, updatedAt: time }] };
    page = await renderApp(`/projects/${f.item.project.id}`);
    expect(document.querySelector('[data-primary-project-action]')?.textContent).toContain('处理 v1.0.2 发布问题');
    expect(document.querySelector('[data-primary-project-action]')?.getAttribute('href')).toContain('release=01a0bf5d-8f4b-7645-8cca-c128d59001d1');
    f.item.releases = { status: 'ready', checkedAt: time, value: [] }; await page.click('刷新');
    expect(document.querySelector('[data-primary-project-action]')?.textContent).toContain('开始开发');
    await page.click('开始开发'); expect(page.path()).toBe(`/projects/${f.item.project.id}/dev-session`); expect(f.writes).toEqual([]);
  });
  test('会话生命周期、连接、预览／正式以及健康分别显示，旧数据不驱动新主动作', async () => {
    const f = summaryFixture(), time = new Date().toISOString(); f.item.development = { status: 'ready', checkedAt: time, value: {
      taskId: '01a0bf5d-8f4b-7e52-8b45-4a547fd10e4f' as TaskId, state: 'running', connected: false, branch: 'main', createdAt: time, lastActivityAt: time } };
    page = await renderApp(`/projects/${f.item.project.id}`); expect(document.querySelector('[data-primary-project-action]')?.textContent).toContain('继续开发');
    expect(page.text()).toContain('会话运行中'); expect(page.text()).toContain('连接已断开'); expect(page.text()).toContain('运行健康需要确认');
    f.error = true; await page.click('刷新'); expect(page.text()).toContain('摘要读取失败'); expect(document.querySelector('[data-primary-project-action]')).toBeNull();
    expect(f.calls.some((url) => url.includes('/slots') || url.includes('/health'))).toBe(false);
  });
});
