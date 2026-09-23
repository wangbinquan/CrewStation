import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { StrictMode, useEffect, useSyncExternalStore } from 'react';
import { messages } from '../app/i18n/zh-CN';
import { AgentActivityProvider, useAgentActivity } from '../shared/activity/AgentActivityProvider';
import type { ActivityTarget } from '../shared/activity/agentActivityView';
import { useActivityTarget } from '../features/dev-session/hooks/native/useActivityTarget';
import { initialWorkspaceLayout, revealTerminal } from '../features/dev-session/model/layout/workspaceLayout';
import { WorkspaceLayoutStore } from '../features/dev-session/model/layout/workspaceLayoutStore';
import { activityFixture, activityProjectId, activityTaskId, activityUserId } from './agentActivityFixture';
import { renderElement } from './renderElement';

const originalFetch = globalThis.fetch;
let rendered: Awaited<ReturnType<typeof renderElement>> | undefined;
afterEach(() => { rendered?.unmount(); rendered = undefined; globalThis.fetch = originalFetch; });

async function fixture() {
  const f = activityFixture(), writes: unknown[] = [];
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    let result: unknown = {};
    if (url.endsWith('/v1/me')) result = { id: activityUserId, name: '测试者', memberships: [], platformRole: 'developer', isAdmin: false };
    else if (url.endsWith('/agent-terminals')) result = f.roster;
    else if (url.endsWith('/agent-activity/read')) { const body = JSON.parse(String(init?.body)); writes.push(body); result = await f.source.read(activityTaskId, body); }
    else if (url.includes('/agent-activity')) result = f.page;
    return new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const initial = { ...initialWorkspaceLayout('工作'), hiddenTerminalIds: [f.terminal.terminalId], view: 'code' as const };
  const layout = new WorkspaceLayoutStore({ get: async () => ({ revision: 1, layout: initial, updatedAt: f.terminal.startedAt }), save: async (input) => ({ revision: input.expectedRevision + 1, layout: input.layout, updatedAt: f.terminal.startedAt }) }, initial);
  await layout.load();
  const target: ActivityTarget = { projectId: activityProjectId, taskId: activityTaskId, agentId: f.terminal.agentId, terminalId: f.terminal.terminalId, turnId: 'turn-one', eventId: 'event-question', seq: 3, navigationId: 'visit-one' };
  return { ...f, writes, layout, target };
}

function Harness({ f, target }: { readonly f: Awaited<ReturnType<typeof fixture>>; readonly target: ActivityTarget }) {
  const { store } = useAgentActivity();
  useEffect(() => { store?.register(activityTaskId, activityProjectId, '验收应用'); }, [store]);
  const state = useSyncExternalStore(f.layout.subscribe, f.layout.getState);
  const error = useActivityTarget(activityTaskId, target, f.roster.items, state.loaded, f.layout);
  return <div><output>{state.layout.view}</output><span>{error ?? ''}</span><button onClick={() => f.layout.update((layout) => ({ ...layout, view: 'code' }))}>去代码</button><section data-native-terminal={f.terminal.terminalId} tabIndex={-1}>原 CLI</section></div>;
}

test('真实 Provider 经 StrictMode 挂载，收起的 CLI 恢复并只标记本人目标；随后可自由切换视图', async () => {
  const f = await fixture();
  rendered = await renderElement(<StrictMode><AgentActivityProvider><Harness f={f} target={f.target} /></AgentActivityProvider></StrictMode>, messages);
  await rendered.settle();
  expect(f.layout.getState().layout.view).toBe('cli'); expect(f.layout.getState().layout.hiddenTerminalIds).toEqual([]);
  expect(f.writes).toContainEqual({ agentId: f.terminal.agentId, turnId: 'turn-one', throughSeq: 3 });
  expect(f.page.states[0]?.pending).toHaveLength(1);
  await rendered.click('去代码'); expect(f.layout.getState().layout.view).toBe('code');
});

test('旧会话或错误终端的定位不改布局、不标记已读', async () => {
  const f = await fixture();
  rendered = await renderElement(<AgentActivityProvider><Harness f={f} target={{ ...f.target, taskId: '01a0bf5d-8f4b-78e3-8b79-df75f85b2367' }} /></AgentActivityProvider>, messages);
  expect(f.layout.getState().layout.view).toBe('code'); expect(f.writes).toEqual([]); expect(rendered.text()).toContain('activity.invalidTarget');
});

test('定位已在标签里的 CLI 只把它设为当前标签、不重排；已关掉的在运行 CLI 回到标签里，焦点组满了在右边分出一组', () => {
  const first = initialWorkspaceLayout('第一组'); first.tabs[0]!.paneOrder = ['a', 'b']; first.tabs[0]!.activeTerminalId = 'a'; first.selectedTerminalId = 'a';
  const second = revealTerminal(first, 'b');
  expect(second.tabs[0]?.paneOrder).toEqual(['a', 'b']); expect(second.tabs[0]?.activeTerminalId).toBe('b'); expect(second.selectedTerminalId).toBe('b');
  expect(revealTerminal(second, 'b')).toBe(second);
  const full = { ...second, tabs: [{ ...second.tabs[0]!, paneOrder: Array.from({ length: 32 }, (_, i) => `cli-${i}`), activeTerminalId: 'cli-0' }], selectedTerminalId: 'cli-0', hiddenTerminalIds: ['hidden'] };
  const restored = revealTerminal(full, 'hidden');
  expect(restored.tabs).toHaveLength(2); expect(restored.hiddenTerminalIds).toEqual([]); expect(restored.tabs[1]?.paneOrder).toEqual(['hidden']);
  expect(restored.dock).toEqual({ direction: 'row', children: [{ group: full.tabs[0]!.id }, { group: restored.tabs[1]!.id }], sizes: [1, 1] });
  expect(restored.activeTabId).toBe(restored.tabs[1]!.id); expect(restored.selectedTerminalId).toBe('hidden');
});
