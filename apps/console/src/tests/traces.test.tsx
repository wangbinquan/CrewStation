import './domSetup';
import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { TraceChainDto, TraceSummaryDto } from '@crewstation/contracts';
import { TraceChainDtoSchema, TraceSummaryDtoSchema } from '@crewstation/contracts';
import { renderApp } from './renderApp';

const originalFetch = globalThis.fetch;
const projectId = '01a0bf5d-8f4b-7e1e-8dde-c9c2ae13ed35', serviceId = '01a0bf5d-8f4b-760b-86b6-0bb9f08a9eab';
const me = '01a0bf5d-8f4b-7e60-8b45-4a547fd10e4f', admin = '01a0bf5d-8f4b-7e61-8b45-4a547fd10e4f';
const sessionTask = '01a0bf5d-8f4b-7e62-8b45-4a547fd10e4f', cliTask = '01a0bf5d-8f4b-7e63-8b45-4a547fd10e4f', businessTask = '01a0bf5d-8f4b-7e64-8b45-4a547fd10e4f', subtaskRun = '01a0bf5d-8f4b-7e65-8b45-4a547fd10e4f';
const eventTrace = 'a'.repeat(32), sessionTrace = 'b'.repeat(32), olderTrace = 'c'.repeat(32);
const project = { id: projectId, serviceId, name: '团队知识助理', slug: 'team-knowledge', kind: 'DigitalWorker', state: 'active', namespace: 'cs-team-knowledge', createdAt: '2026-09-13T01:00:00.000Z' };
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });

// 夹具先过契约：写错的夹具错在这里，不在后面的断言上。
const rows: TraceSummaryDto[] = [
  TraceSummaryDtoSchema.parse({ traceId: eventTrace, status: 'failed', startedAt: '2026-09-23T10:20:00.000Z', lastActivityAt: '2026-09-23T10:21:00.000Z', sources: ['event', 'business-task'],
    event: { eventType: 'gitlab.push', state: 'delivered', attempts: 1 }, business: { tasks: 1, subtasks: 2, failedSubtasks: 1 } }),
  TraceSummaryDtoSchema.parse({ traceId: sessionTrace, status: 'running', startedAt: '2026-09-23T10:00:00.000Z', lastActivityAt: '2026-09-23T10:30:00.000Z', sources: ['dev-session'],
    devSession: { createdBy: me, branch: 'main', clis: 1, agents: 0 } }),
];
const older = TraceSummaryDtoSchema.parse({ traceId: olderTrace, status: 'ended', startedAt: '2026-09-20T08:00:00.000Z', lastActivityAt: '2026-09-20T08:10:00.000Z', sources: ['dev-session'], devSession: { createdBy: admin, clis: 0, agents: 0 } });
const businessChain: TraceChainDto = TraceChainDtoSchema.parse({
  traceId: eventTrace, status: 'failed', startedAt: '2026-09-23T10:20:00.000Z', lastActivityAt: '2026-09-23T10:21:00.000Z', sources: ['event', 'business-task'],
  event: { deliveryId: '01a0bf5d-8f4b-7e66-8b45-4a547fd10e4f', eventId: '01a0bf5d-8f4b-7e67-8b45-4a547fd10e4f', eventType: 'gitlab.push', state: 'delivered', attempts: 1, createdAt: '2026-09-23T10:20:00.000Z', deliveredAt: '2026-09-23T10:20:01.000Z' },
  tasks: [{ taskId: businessTask, kind: 'business', state: 'released', status: 'failed', createdAt: '2026-09-23T10:20:02.000Z', lastActivityAt: '2026-09-23T10:21:00.000Z', endedAt: '2026-09-23T10:21:00.000Z', message: 'released: business',
    business: { state: 'closed', callerIdentity: 'team-knowledge/team-knowledge', closedAt: '2026-09-23T10:21:00.000Z' },
    executions: [{ taskId: subtaskRun, purpose: 'subtask', agentId: 'agent-1', profileName: 'coding-medium', protocol: 'opencode', status: 'failed', startedAt: '2026-09-23T10:20:03.000Z', endedAt: '2026-09-23T10:20:50.000Z',
      subtaskId: '01a0bf5d-8f4b-7e68-8b45-4a547fd10e4f', sessionIds: ['ses_3f2a9d0c11'], events: 3 }],
    subtasks: [{ subtaskId: '01a0bf5d-8f4b-7e68-8b45-4a547fd10e4f', name: 'analysis', kind: 'agent', state: 'failed', attempt: 1, error: '输出不符合契约', createdAt: '2026-09-23T10:20:03.000Z', endedAt: '2026-09-23T10:20:50.000Z', executionTaskId: subtaskRun }],
  }],
});
const sessionChain: TraceChainDto = TraceChainDtoSchema.parse({
  traceId: sessionTrace, status: 'running', startedAt: '2026-09-23T10:00:00.000Z', lastActivityAt: '2026-09-23T10:30:00.000Z', sources: ['dev-session'],
  tasks: [{ taskId: sessionTask, kind: 'dev-session', state: 'running', status: 'running', createdAt: '2026-09-23T10:00:00.000Z', lastActivityAt: '2026-09-23T10:30:00.000Z', createdBy: me, branch: 'main',
    executions: [{ taskId: cliTask, purpose: 'cli', agentId: 'agent-2', profileName: 'coding-medium', protocol: 'claude-code', status: 'running', startedAt: '2026-09-23T10:01:00.000Z', sessionIds: [], events: 0 }], subtasks: [] }],
});

/** 满满一页（50 条）：两条真实形态的链加 48 条已结束的会话，末尾给游标。 */
const fullPage = [...rows, ...Array.from({ length: 48 }, (_, i) => TraceSummaryDtoSchema.parse({ traceId: (i + 1).toString(16).padStart(32, '0'), status: 'ended', startedAt: '2026-09-22T09:00:00.000Z',
  lastActivityAt: '2026-09-22T09:10:00.000Z', sources: ['dev-session'], devSession: { clis: 0, agents: 0 } }))];

const lostTrace = 'd'.repeat(32);
const lostChain: TraceChainDto = TraceChainDtoSchema.parse({
  traceId: lostTrace, status: 'failed', startedAt: '2026-09-22T08:00:00.000Z', lastActivityAt: '2026-09-22T08:30:00.000Z', sources: ['dev-session'],
  tasks: [{ taskId: '01a0bf5d-8f4b-7e69-8b45-4a547fd10e4f', kind: 'dev-session', state: 'failed', status: 'failed', createdAt: '2026-09-22T08:00:00.000Z', lastActivityAt: '2026-09-22T08:30:00.000Z',
    endedAt: '2026-09-22T08:30:00.000Z', message: '开发容器被 OOMKilled', executions: [], subtasks: [] }],
});

interface FixtureOptions { readonly list?: 'rows' | 'full' | 'empty' | 'error' | 'partial' }
function fixture(options: FixtureOptions = {}) {
  const calls: URL[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url, 'http://localhost');
    calls.push(url);
    let status = 200, body: unknown = { items: [] };
    const cursor = url.searchParams.get('cursor');
    if (url.pathname === '/v1/me') body = { id: me, name: '小林', platformRole: 'developer', isAdmin: false, memberships: [{ projectId, role: 'owner' }] };
    else if (url.pathname === `/v1/projects/${projectId}`) body = project;
    else if (url.pathname === `/v1/projects/${projectId}/members`) body = { items: [{ userId: me, name: '小林', role: 'owner' }] };
    else if (url.pathname === `/v1/projects/${projectId}/traces`) {
      if (options.list === 'error') { status = 503; body = { error: 'unavailable', message: '调用链暂时读不到' }; }
      else if (options.list === 'empty') body = { items: [] };
      else if (options.list === 'partial') body = cursor ? { items: [older] } : { items: [], nextCursor: `2026-09-21T00:00:00.000Z~${'d'.repeat(32)}` };
      else if (options.list === 'full') body = cursor ? { items: [older] } : { items: fullPage, nextCursor: `2026-09-22T09:00:00.000Z~${'0'.repeat(31)}1` };
      else body = { items: rows };
    } else if (url.pathname === `/v1/projects/${projectId}/traces/${eventTrace}`) body = businessChain;
    else if (url.pathname === `/v1/projects/${projectId}/traces/${sessionTrace}`) body = sessionChain;
    else if (url.pathname === `/v1/projects/${projectId}/traces/${lostTrace}`) body = lostChain;
    else if (url.pathname === `/v1/projects/${projectId}/traces/${eventTrace}/executions/${subtaskRun}/events`) body = cursor
      ? { items: [{ seq: 9, at: '2026-09-23T10:20:50.000Z', kind: 'agent', type: 'error', error: '额度用尽' }] }
      : { items: [{ seq: 1, at: '2026-09-23T10:20:04.000Z', kind: 'agent', type: 'tool-start', tool: { name: 'bash' } }, { seq: 2, at: '2026-09-23T10:20:10.000Z', kind: 'agent', type: 'text', text: '分析完成' }], nextCursor: '2' };
    else if (url.pathname.includes('/traces/')) { status = 404; body = { error: 'not_found', message: '本项目的调用链不存在' }; }
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { calls, listCalls: () => calls.filter((url) => url.pathname === `/v1/projects/${projectId}/traces`) };
}

const operations = (query = '') => `/projects/${projectId}/operations?tab=trace${query}`;
const rowTitles = () => [...document.querySelectorAll('[aria-label="本应用的调用链"] li')].map((li) => li.querySelector('button')?.textContent);
async function select(node: HTMLSelectElement, value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event('change', { bubbles: true })); });
}

describe('调用链列表', () => {
  test('按开始时间倒序列出本应用的链：起点、结果与状态；会话创建人按成员名单显示；没有更多时不给「加载更多」', async () => {
    fixture(); page = await renderApp(operations());
    expect(rowTitles()).toEqual(['事件 gitlab.push → 业务任务', '开发会话 · 小林']);
    expect(page.text()).not.toContain('加载更多');
    expect(page.text()).toContain('已送达 · 第 1 次尝试'); expect(page.text()).toContain('2 个子任务，1 个失败'); expect(page.text()).toContain('分支 main');
    expect(page.text()).toContain('失败'); expect(page.text()).toContain('进行中');
    expect(page.text()).toContain('在左侧选一条调用链');
  });

  test('还没有调用链时说明链从哪来；筛选后为空时换一句', async () => {
    fixture({ list: 'empty' }); page = await renderApp(operations());
    expect(page.text()).toContain('还没有调用链'); expect(page.text()).toContain('每一个都会产生一条调用链');
    page.unmount(); page = await renderApp(operations('&traceStatus=failed'));
    expect(page.text()).toContain('没有符合筛选条件的调用链'); expect(page.text()).not.toContain('每一个都会产生一条调用链');
  });

  test('读取失败时写明原因，不显示空列表', async () => {
    fixture({ list: 'error' }); page = await renderApp(operations());
    expect(page.text()).toContain('调用链暂时读不到'); expect(page.text()).not.toContain('还没有调用链');
  });

  test('筛选写进地址并带到查询参数上；「全部」不带参数', async () => {
    const f = fixture(); page = await renderApp(operations());
    const [source, status, window] = [...document.querySelectorAll<HTMLSelectElement>('select')];
    await select(source!, 'event'); await select(status!, 'failed'); await select(window!, '24h');
    expect(page.search()).toEqual({ tab: 'trace', traceSource: 'event', traceStatus: 'failed', traceWindow: '24h' });
    expect(Object.fromEntries(f.listCalls().at(-1)!.searchParams)).toEqual({ source: 'event', status: 'failed', window: '24h', limit: '50' });
    await select(source!, ''); await select(window!, 'all');
    expect(page.search()).toEqual({ tab: 'trace', traceStatus: 'failed' });
    expect(Object.fromEntries(f.listCalls().at(-1)!.searchParams)).toEqual({ status: 'failed', window: 'all', limit: '50' });
  });

  test('「加载更多」带上一页的游标往前翻，追加在后面；筛选保留；翻到底后不再显示', async () => {
    const f = fixture({ list: 'full' }); page = await renderApp(operations('&traceStatus=ended'));
    expect(rowTitles()).toHaveLength(50); expect(page.text()).not.toContain('更早的还没查');
    await page.click('加载更多');
    expect(f.listCalls().at(-1)!.searchParams.get('cursor')).toBe(`2026-09-22T09:00:00.000Z~${'0'.repeat(31)}1`);
    expect(f.listCalls().at(-1)!.searchParams.get('status')).toBe('ended');
    expect(rowTitles()).toHaveLength(51); expect(rowTitles().at(-1)).toBe(`开发会话 · 用户 ${admin.slice(0, 8)}…`);
    expect(page.text()).not.toContain('加载更多');
  });

  test('一页没找够却还有游标时，写明查到了哪一刻，按钮叫「继续往前查找」', async () => {
    fixture({ list: 'partial' }); page = await renderApp(operations('&traceStatus=failed'));
    expect(page.text()).toContain('更早的还没查'); expect(page.text()).not.toContain('没有符合筛选条件');
    await page.click('继续往前查找');
    expect(rowTitles()).toHaveLength(1);
  });
});

describe('调用链回放', () => {
  test('点一行在右侧打开：地址带上 traceId、那一行标为当前；起点事件、业务任务、子任务与它的 Agent 执行分层显示', async () => {
    fixture(); page = await renderApp(operations());
    await page.click('事件 gitlab.push → 业务任务');
    expect(page.search()).toEqual({ tab: 'trace', traceId: eventTrace });
    expect(document.querySelector('li[aria-current="true"]')?.textContent).toContain('事件 gitlab.push');
    const text = page.text();
    for (const expected of ['起点 · 事件 gitlab.push', '已送达', '业务任务', '由 team-knowledge/team-knowledge 创建', '已关闭', '子任务 analysis', '第 1 次', '输出不符合契约', 'Agent 执行（opencode）', 'coding-medium', '会话 ses_3f2a…'])
      expect(text).toContain(expected);
    // 已结束的业务任务不给日志入口：Pod 已经回收，读不到日志。
    expect(document.querySelector(`a[href*="source=business-task"]`)).toBeNull();
  });

  test('展开一个执行的事件：逐条显示种类与内容，「更多事件」带序号往后翻，收起后不再显示', async () => {
    const f = fixture(); page = await renderApp(operations(`&traceId=${eventTrace}`));
    await page.click('查看事件（3）');
    expect(page.text()).toContain('调用工具 · bash'); expect(page.text()).toContain('输出 · 分析完成');
    await page.click('更多事件');
    expect(f.calls.at(-1)!.searchParams.get('cursor')).toBe('2'); expect(page.text()).toContain('出错 · 额度用尽');
    await page.click('收起事件'); expect(page.text()).not.toContain('分析完成');
  });

  test('进行中的开发会话给「日志」与「打开开发页」，CLI 带协议与档位', async () => {
    fixture(); page = await renderApp(operations(`&traceId=${sessionTrace}`));
    expect(page.text()).toContain('CLI（claude-code）'); expect(page.text()).toContain('小林 创建');
    const logs = [...document.querySelectorAll<HTMLAnchorElement>('a')].find((a) => a.textContent === '日志')!;
    expect(new URL(logs.href, 'http://localhost').search).toBe(`?tab=logs&source=dev-session&taskId=${sessionTask}`);
    expect([...document.querySelectorAll('a')].some((a) => a.textContent === '打开开发页')).toBe(true);
  });

  test('环境备注只在环境本身失败时显示：正常释放的内部备注不显示，容器失败的原因显示', async () => {
    fixture(); page = await renderApp(operations(`&traceId=${eventTrace}`));
    // 2026-09-23 实机：子任务失败的业务任务下面多出一行「released: business」，那是环境正常释放时的内部备注。
    expect(page.text()).toContain('输出不符合契约'); expect(page.text()).not.toContain('released: business');
    page.unmount(); page = await renderApp(operations(`&traceId=${lostTrace}`));
    expect(page.text()).toContain('开发容器被 OOMKilled');
  });

  test('窄屏（详情排在列表下面）选中一条后把详情滚进视野；宽屏左右并排时不滚页面，只把详情栏滚回顶', async () => {
    fixture(); page = await renderApp(operations());
    const scrolled: Element[] = [], original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this); };
    try {
      // happy-dom 没有布局：按实机 390px 与 1440px 的相对位置注入列表栏与详情栏的边框。
      const list = document.querySelector('[aria-label="本应用的调用链"]')!.closest('section')!.parentElement!, aside = list.nextElementSibling as HTMLElement;
      const rect = (top: number, bottom: number) => () => new DOMRect(0, top, 300, bottom - top);
      list.getBoundingClientRect = rect(0, 900); aside.getBoundingClientRect = rect(912, 1400);
      // 只比较数量与同一性：对 happy-dom 节点做 toEqual，失败时序列化节点会让整套用例像卡死（dev-gotchas）。
      await page.click('开发会话 · 小林');
      expect(scrolled.length).toBe(1); expect(scrolled[0] === aside).toBe(true); expect(page.search().traceId).toBe(sessionTrace);
      aside.getBoundingClientRect = rect(0, 600); aside.scrollTop = 240;
      await page.click('事件 gitlab.push → 业务任务');
      expect(scrolled.length).toBe(1); expect(aside.scrollTop).toBe(0); expect(page.search().traceId).toBe(eventTrace);
    } finally { Element.prototype.scrollIntoView = original; }
  });

  test('两栏的高度量到窗口底边：窗口变了重新量，窗口过矮时不低于 360px', async () => {
    fixture(); page = await renderApp(operations());
    const host = document.querySelector('[aria-label="本应用的调用链"]')!.closest('section')!.parentElement!.parentElement!.parentElement!;
    host.getBoundingClientRect = () => new DOMRect(0, 180, 1000, 400);
    await act(async () => { window.dispatchEvent(new Event('resize')); });
    expect(host.style.getPropertyValue('--viewport-fill')).toBe(`${window.innerHeight - 180}px`);
    host.getBoundingClientRect = () => new DOMRect(0, window.innerHeight - 100, 1000, 400);
    await act(async () => { window.dispatchEvent(new Event('resize')); });
    expect(host.style.getPropertyValue('--viewport-fill')).toBe('360px');
  });

  test('本项目里没有这条链时写明原因（可能属于别的项目）', async () => {
    fixture(); page = await renderApp(operations(`&traceId=${'f'.repeat(32)}`));
    expect(page.text()).toContain('本项目里没有这条调用链'); expect(page.text()).toContain('每个应用只看得到自己的那一部分');
  });
});
