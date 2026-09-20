import './domSetup';
import { afterEach, describe, expect, test } from 'bun:test';
import { act, useState } from 'react';
import { AgentInstanceDtoSchema } from '@crewstation/contracts';
import type { ComputeProfileSummaryDto } from '@crewstation/contracts';
import { AgentRoster } from '../features/dev-session/components/agents/AgentRoster';
import { StartAgentForm } from '../features/dev-session/components/agents/StartAgentForm';
import { NativeWorkspace } from '../features/dev-session/components/native/NativeWorkspace';
import type { HistoricalStartHandle } from '../features/dev-session/hooks/useHistoricalStart';
import { messages } from '../features/dev-session/i18n/zh-CN';
import { choiceBlocked, choicesFor, resolveChoice } from '../features/dev-session/model/computeChoices';
import { initialWorkspaceLayout } from '../features/dev-session/model/layout/workspaceLayout';
import { INITIAL_STREAM_STATE } from '../features/dev-session/model/taskStreamSocket';
import { activityFixture } from './agentActivityFixture';
import { renderElement } from './renderElement';

const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderElement>> | undefined;
afterEach(async () => { page?.unmount(); page = undefined; await new Promise((resolve) => setTimeout(resolve, 0)); globalThis.fetch = originalFetch; });

const CATALOG: ComputeProfileSummaryDto[] = [
  { id: '01a0bf5d-8f4b-7b93-8744-95d0bccdf6a2', name: 'claude-daily', description: '日常开发', terminalOnly: false, isDefault: true, available: true },
  { id: '01a0bf5d-8f4b-76dc-87b8-87b3fd611c0f', name: 'aider-shell', description: '终端 CLI', terminalOnly: true, isDefault: false, available: true },
  { id: '01a0bf5d-8f4b-7202-82a4-92fec671e7a3', name: 'opencode-lite', description: '', terminalOnly: false, isDefault: false, available: false, reason: '测试失败：缺少鉴权' },
];
const withoutDefault = CATALOG.map((item) => ({ ...item, isDefault: false }));

describe('租户面档位选择（RFC-006 C6、C17）', () => {
  test('headless Agent 不列通用终端；空值即默认档位；默认缺失、档位消失或不可用都给出原因', () => {
    expect(choicesFor(CATALOG, 'agent').map((item) => item.name)).toEqual(['claude-daily', 'opencode-lite']);
    expect(choicesFor(CATALOG, 'cli').map((item) => item.name)).toEqual(['claude-daily', 'aider-shell', 'opencode-lite']);
    expect(resolveChoice(CATALOG, '')?.name).toBe('claude-daily');
    expect([choiceBlocked(CATALOG, ''), choiceBlocked(CATALOG, CATALOG[1]!.id), choiceBlocked(CATALOG, CATALOG[2]!.id), choiceBlocked(CATALOG, 'gone')]).toEqual([undefined, undefined, 'unavailable', 'missing']);
    expect(choiceBlocked(withoutDefault, '')).toBe('no-default');
    expect(choiceBlocked(CATALOG.map((item) => ({ ...item, available: false, reason: '已停用' })), '')).toBe('unavailable');
  });
});

function serveCatalog(items: readonly ComputeProfileSummaryDto[], extra: (url: string, init?: RequestInit) => unknown = () => undefined) {
  globalThis.fetch = (async (raw: RequestInfo | URL, init?: RequestInit) => {
    const url = String(raw);
    const body = url.endsWith('/v1/projects/project-1/compute-profiles') ? { items } : extra(url, init) ?? { items: [] };
    return body instanceof Response ? body : new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

/** 新建 Agent 表单只认草稿句柄：这里用本地状态代替 useHistoricalStart，只观察表单本身。 */
function Form({ initial, started }: { readonly initial: string; readonly started: string[] }) {
  const [compute, setCompute] = useState(initial);
  const creation = { compute, permission: 'edit', prompt: '整理需求', busy: false, open: true, dirty: false, setOpen: () => {}, start: () => started.push(compute),
    edit: (change: { compute?: string }) => { if (change.compute !== undefined) setCompute(change.compute); } } as unknown as HistoricalStartHandle;
  return <StartAgentForm projectId="project-1" creation={creation} />;
}
const select = () => page!.host.querySelector<HTMLSelectElement>('#agent-compute')!;
const options = () => [...select().options].map((option) => [option.value, option.textContent, option.disabled]);

describe('新建 Agent（历史对话）', () => {
  test('只列讲协议的档位：默认项写出默认档位名，不可用的档位禁选并写明原因', async () => {
    serveCatalog(CATALOG); const started: string[] = [];
    page = await renderElement(<Form initial="" started={started} />, messages);
    expect(options()).toEqual([['', '默认档位（claude-daily）', false], [CATALOG[0]!.id, 'claude-daily · 日常开发', false], [CATALOG[2]!.id, 'opencode-lite（不可用：测试失败：缺少鉴权）', true]]);
    expect(page.text()).not.toContain('aider-shell');
    await page.click('启动');
    expect(started).toEqual(['']);
  });

  test('之前选中的档位变得不可用或被删除、平台没有默认档位时不许启动，并说明原因', async () => {
    serveCatalog(CATALOG);
    page = await renderElement(<Form initial={CATALOG[2]!.id} started={[]} />, messages);
    expect(page.text()).toContain('档位 opencode-lite 当前不可用：测试失败：缺少鉴权。'); expect(page.button('启动').disabled).toBe(true);
    page.unmount();
    page = await renderElement(<Form initial="gone-profile" started={[]} />, messages);
    expect(page.text()).toContain('所选档位已不存在或不再授予此项目，请重新选择。'); expect(page.button('启动').disabled).toBe(true);
    page.unmount();
    serveCatalog(withoutDefault);
    page = await renderElement(<Form initial="" started={[]} />, messages);
    expect(options()[0]).toEqual(['', '默认档位（项目尚未设置）', false]);
    expect(page.text()).toContain('此项目尚未设置默认档位'); expect(page.button('启动').disabled).toBe(true);
  });

  test('项目允许清单为空时说明需要分配，不能误报平台没有档位', async () => {
    serveCatalog([]); page = await renderElement(<Form initial="" started={[]} />, messages);
    expect(page.text()).toContain('此项目尚未分配算力档位'); expect(page.button('启动').disabled).toBe(true);
  });

  test('名册标出每个 Agent 受理时固定的档位修订，只有档位名与修订，没有模型', async () => {
    const agent = AgentInstanceDtoSchema.parse({ agentId: 'agent-abcdef', taskId: '01a0bf5d-8f4b-7cb2-839d-fa8c82dbc4ee', compute: CATALOG[0]!.id, computeName: 'claude-daily', permission: 'edit', state: 'running', startedAt: '2026-09-17T00:00:00.000Z', profileRevision: 3 });
    page = await renderElement(<AgentRoster agents={[agent, { ...agent, agentId: 'agent-legacy', profileRevision: undefined }]} selected={agent.agentId} onSelect={() => {}} />, messages);
    const tabs = [...page.host.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent ?? '');
    expect(tabs[0]).toContain('L-abcdef · claude-daily'); expect(tabs[0]).toContain('档位修订 3');
    expect(tabs[1]).not.toContain('档位修订');
  });
});

describe('「＋ 创建开发Agent会话」', () => {
  const workspace = () => <NativeWorkspace projectId="project-1" taskId="task-1" userId="user-1" channel={{ send: async () => ({}), subscribe: () => () => {} }} stream={{ ...INITIAL_STREAM_STATE, status: 'open', runnerConnected: true, generation: 1 }} canDevelop onActivity={() => {}} preview={null} editor={null} changes={null} />;
  const cliSelect = () => page!.host.querySelector<HTMLSelectElement>('select[aria-label="算力档位"]')!;

  test('列出全部档位（通用终端标「仅终端」），选中的档位随启动请求发出', async () => {
    const starts: Array<Record<string, unknown>> = [];
    serveCatalog(CATALOG, (url, init) => {
      if (url.endsWith('/workspace-layout')) return init?.method === 'PUT' ? { ...JSON.parse(String(init.body)), revision: 1, updatedAt: '2026-09-17T00:00:00.000Z' } : { revision: 0, layout: null, updatedAt: null };
      if (url.endsWith('/agent-terminals') && init?.method === 'POST') { starts.push(JSON.parse(String(init.body))); return Response.json({ error: 'precondition', message: '演示拒绝', details: {} }, { status: 412 }); }
      if (url.endsWith('/agent-terminals')) return { items: [], connection: 'connected', runnerId: null, checkedAt: '2026-09-17T00:00:00.000Z' };
      return undefined;
    });
    page = await renderElement(workspace(), messages);
    expect([...cliSelect().options].map((option) => option.textContent)).toEqual(['默认档位（claude-daily）', 'claude-daily', 'aider-shell · 仅终端', 'opencode-lite（不可用：测试失败：缺少鉴权）']);
    expect(page.button('＋ 创建开发Agent会话').disabled).toBe(false);
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(cliSelect(), CATALOG[1]!.id); cliSelect().dispatchEvent(new Event('change', { bubbles: true })); });
    await page.settle();
    await page.click('＋ 创建开发Agent会话');
    expect(starts).toHaveLength(1); expect(starts[0]).toMatchObject({ compute: { kind: 'profile', profileId: CATALOG[1]!.id } }); expect(page.text()).toContain('演示拒绝');
  });

  test('默认档位不可用时拦住启动；卡片标出通用终端协议与固定的档位修订', async () => {
    const layout = initialWorkspaceLayout('工作区 1'), terminal = { ...activityFixture().terminal, protocol: 'terminal', profileRevision: 4 };
    layout.tabs[0]!.paneOrder = [terminal.terminalId];
    serveCatalog(CATALOG.map((item) => (item.isDefault ? { ...item, available: false, reason: '测试中' } : item)), (url) => {
      if (url.endsWith('/workspace-layout')) return { layout, revision: 1, updatedAt: terminal.startedAt };
      if (url.endsWith('/agent-terminals')) return { items: [terminal], connection: 'connected', runnerId: terminal.runnerId, checkedAt: terminal.startedAt, activitySync: 'ready' };
      return undefined;
    });
    page = await renderElement(workspace(), messages);
    expect(page.text()).toContain('档位 claude-daily 当前不可用：测试中。'); expect(page.button('＋ 创建开发Agent会话').disabled).toBe(true);
    const card = page.host.querySelector(`[data-native-terminal="${terminal.terminalId}"]`)!;
    expect(card.textContent).toContain('仅终端'); expect(card.textContent).toContain('档位修订 4');
    expect(card.querySelector('small[title]')?.getAttribute('title')).toContain('平台不解析它的输出');
  });
});
