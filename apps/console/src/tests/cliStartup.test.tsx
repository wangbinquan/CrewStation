import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { NativeTerminalDto, StartupProgress } from '@crewstation/contracts';
import { TaskIdSchema } from '@crewstation/contracts';
import { NativeTerminalView } from '../features/dev-session/components/native/NativeTerminalView';
import type { TaskStreamChannel } from '../features/dev-session/hooks/useTaskStream';
import { holdsDuringStartup } from '../features/dev-session/hooks/native/useCreatorClaim';
import { creatorClaims } from '../features/dev-session/model/native/creatorClaims';
import { INITIAL_STREAM_STATE } from '../features/dev-session/model/taskStreamSocket';
import { messages } from '../features/dev-session/i18n/zh-CN';
import { activityFixture } from './agentActivityFixture';
import { renderElement } from './renderElement';

const at = (second: number) => new Date(Date.parse('2026-09-23T03:00:00.000Z') + second * 1000).toISOString();
const running: StartupProgress = {
  state: 'running', startedAt: at(0), observedAt: at(6),
  stages: [
    { kind: 'queue', state: 'succeeded', startedAt: at(0), endedAt: at(0.6), durationMs: 600 },
    { kind: 'container', state: 'succeeded', startedAt: at(0.6), endedAt: at(3.9), durationMs: 3300 },
    { kind: 'connect', state: 'succeeded', startedAt: at(3.9), endedAt: at(4.5), durationMs: 600 },
    { kind: 'prepare', state: 'running', startedAt: at(4.5), count: { done: 1, total: 2 }, detail: '写入 settings.json' },
    { kind: 'agent', state: 'pending' }, { kind: 'ready', state: 'pending' },
  ],
};
const base = (): NativeTerminalDto => ({ ...activityFixture().terminal, clientRequestId: crypto.randomUUID(), lifecycle: 'starting', computeName: 'volc-glm-5-2', protocol: 'opencode', startup: running,
  execution: { taskId: TaskIdSchema.parse('01a0bf5d-8f4b-7abc-8123-777777777777'), state: 'running', message: '此CLI的执行容器已运行，等待环境连接' } });
const connected = { ...INITIAL_STREAM_STATE, status: 'open' as const, runnerConnected: true };

let page: Awaited<ReturnType<typeof renderElement>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; });

/** 假通道：附着即给快照；取得在 rejectClaim 为真时像旧 Runner 那样在启动中拒绝。 */
function fakeChannel() {
  const sent: Array<Record<string, unknown>> = [], state = { rejectClaim: false };
  const channel: TaskStreamChannel = {
    send: async (command) => {
      const payload = command as unknown as Record<string, unknown>;
      sent.push(payload);
      if (payload.type === 'attachTerminal') return { terminalId: payload.terminalId, runnerId: payload.runnerId, cols: 80, rows: 24, data: '', throughSeq: 0, truncated: false, scrollbackLimit: 500 };
      if (payload.type === 'claimTerminalControl') {
        if (state.rejectClaim) throw new Error('CLI 进程尚未运行或已经结束');
        return { controlled: true, expiresAt: null, control: { held: true, holder: { userId: 'me', name: '我' }, revision: sent.length } };
      }
      return {};
    },
    subscribe: () => () => {},
  };
  return { channel, sent, state, claims: () => sent.filter((command) => command.type === 'claimTerminalControl').length };
}

const harness: { set?: (terminal: NativeTerminalDto) => void } = {};
const update = (terminal: NativeTerminalDto) => harness.set?.(terminal);
function Harness({ initial, channel, onRetry }: { readonly initial: NativeTerminalDto; readonly channel: TaskStreamChannel; readonly onRetry?: (terminal: NativeTerminalDto) => void }): ReactElement {
  const [terminal, setTerminal] = useState(initial);
  useEffect(() => { harness.set = setTerminal; }, []);
  return <NativeTerminalView terminal={terminal} channel={channel} stream={connected} onActivity={() => {}} canDevelop viewerId="me" {...(onRetry ? { onRetry } : {})} />;
}

test('启动中：终端区域中间是六段步骤条，状态条显示当前段；xterm 照常附着，只是被盖住', async () => {
  const f = fakeChannel(), terminal = base();
  page = await renderElement(<Harness initial={terminal} channel={f.channel} />, messages);
  const pane = page.host.querySelector('[data-native-terminal], section[data-state="running"]')!;
  expect(pane.getAttribute('aria-label')).toBe('正在启动 CLI · volc-glm-5-2');
  expect([...page.host.querySelectorAll('li')].map((li) => li.getAttribute('data-state'))).toEqual(['succeeded', 'succeeded', 'succeeded', 'running', 'pending', 'pending']);
  expect(page.host.querySelector('[role="status"]')!.textContent).toContain('启动中 4/6 · 准备环境（启动前步骤 1/2） · 写入 settings.json');
  // 步骤条盖着终端时不提示「回看会话历史」（2026-09-23 实机：启动中就取得了控制，提示跟着出来）。
  expect(page.host.querySelector('[role="status"]')!.textContent).not.toContain('回看会话历史');
  expect(f.sent.some((command) => command.type === 'attachTerminal')).toBe(true);
  expect(page.host.querySelector('[role="region"]')).not.toBeNull();
  // 就绪后换回终端：步骤条移除，状态条回到输入控制。
  await act(async () => update({ ...terminal, lifecycle: 'running', startup: { ...running, state: 'ready', stages: running.stages.map((stage) => ({ ...stage, state: 'succeeded' as const })) } })); await page.settle();
  expect(page.host.querySelector('section[data-state]')).toBeNull();
  expect(page.host.querySelector('[role="status"]')!.textContent).toContain('空闲 · 点击终端即可输入');
  expect(page.host.querySelector('[role="status"]')!.textContent).toContain('回看会话历史');
});

test('创建者的窗口：启动中就提前取得（新 Runner）；旧 Runner 拒绝时不报错，进程拉起后再取，并把焦点移进终端；只做一次', async () => {
  const f = fakeChannel(), terminal = base();
  f.state.rejectClaim = true;
  creatorClaims.remember(terminal.clientRequestId);
  page = await renderElement(<Harness initial={terminal} channel={f.channel} />, messages);
  expect(f.claims()).toBe(1);
  expect(page.text()).not.toContain('CLI 进程尚未运行或已经结束');
  f.state.rejectClaim = false;
  await act(async () => update({ ...terminal, lifecycle: 'running', startup: { ...running, state: 'ready' } })); await page.settle();
  expect(f.claims()).toBe(2);
  expect(creatorClaims.has(terminal.clientRequestId)).toBe(false);
  expect(page.host.querySelector('[role="region"]')!.contains(document.activeElement)).toBe(true);
  expect(page.host.querySelector('[data-control]')!.getAttribute('data-control')).toBe('mine');
  await act(async () => update({ ...terminal, lifecycle: 'running', revision: 9, startup: { ...running, state: 'ready' } })); await page.settle();
  expect(f.claims()).toBe(2);
});

test('创建者的窗口：用户这时正在别处输入就只取得、不抢焦点；不是本窗口创建的 CLI 不自动取得', async () => {
  const input = document.createElement('input');
  document.body.appendChild(input);
  const mine = fakeChannel(), terminal = base();
  creatorClaims.remember(terminal.clientRequestId);
  page = await renderElement(<Harness initial={{ ...terminal, lifecycle: 'running', startup: { ...running, state: 'ready' } }} channel={mine.channel} />, messages);
  input.focus();
  await act(async () => update({ ...terminal, lifecycle: 'running', revision: 3, startup: { ...running, state: 'ready' } })); await page.settle();
  expect(mine.claims()).toBe(1);
  expect(document.activeElement).toBe(input);
  page.unmount(); page = undefined; input.remove();
  const other = fakeChannel();
  page = await renderElement(<Harness initial={base()} channel={other.channel} />, messages);
  await act(async () => update({ ...base(), lifecycle: 'running' })); await page.settle();
  expect(other.claims()).toBe(0);
});

test('启动失败：停在出错的那一段，写出原因，给「重试」与「查看执行容器日志」；日志未到先写正在收集，等不到才是说明', async () => {
  const failed: StartupProgress = { ...running, state: 'failed', endedAt: at(9), stages: [running.stages[0]!, running.stages[1]!, running.stages[2]!,
    { kind: 'prepare', state: 'failed', startedAt: at(4.5), endedAt: at(9), durationMs: 4500, count: { done: 0, total: 2 }, error: { code: 'before-start-failed', message: '启动前步骤「安装依赖」失败：退出码 1' }, logTail: 'npm ERR! code E404' },
    { kind: 'agent', state: 'pending' }, { kind: 'ready', state: 'pending' }] };
  const retried: NativeTerminalDto[] = [], f = fakeChannel(), terminal = { ...base(), lifecycle: 'failed' as const, reason: 'before-start-failed' as const, startup: failed };
  page = await renderElement(<Harness initial={terminal} channel={f.channel} onRetry={(item) => retried.push(item)} />, messages);
  expect(page.host.querySelector('section[data-state="failed"]')!.getAttribute('aria-label')).toBe('CLI 启动失败 · volc-glm-5-2');
  expect(page.host.querySelector('[data-control="failed"]')!.textContent).toBe('启动失败 · 准备环境（启动前步骤 0/2）：启动前步骤「安装依赖」失败：退出码 1');
  expect(f.sent).toEqual([]);
  await page.click('重试');
  expect(retried.map((item) => item.agentId)).toEqual([terminal.agentId]);
  await page.click('查看执行容器日志');
  expect(page.host.querySelector('pre')!.textContent).toBe('npm ERR! code E404');
  // 日志由回收流程补上，比「失败」晚几秒：失败后 20 秒内（服务器时间）先写「正在收集」，过了还没有才是说明。
  const withoutLog = { ...failed, stages: failed.stages.map(({ logTail: _dropped, ...stage }) => stage) };
  await act(async () => update({ ...terminal, startup: { ...withoutLog, observedAt: at(10) } })); await page.settle();
  expect(page.text()).toContain('正在收集容器日志…');
  await act(async () => update({ ...terminal, startup: { ...withoutLog, observedAt: at(30) } })); await page.settle();
  expect(page.text()).toContain('执行容器没有留下日志（容器没有启动，或者日志为空），原因见上。');
});

// RFC-024：「已就绪」推迟到 CLI 画出界面后，进程拉起到界面画出之间创建者的窗口仍算「在用」，
// 否则焦点在别处时 30 秒空闲释放掉控制，OpenCode 等不到终端查询的应答、界面一直画不出来。
test('RFC-024：创建者窗口在「CLI 初始化」期间仍算在用；就绪、结束或不是本窗口创建的都不算', () => {
  const initializing = { lifecycle: 'running' as const, startup: { ...running, state: 'running' as const } };
  expect(holdsDuringStartup(true, { lifecycle: 'starting', startup: running })).toBe(true);
  expect(holdsDuringStartup(true, initializing)).toBe(true);
  expect(holdsDuringStartup(true, { lifecycle: 'running', startup: { ...running, state: 'ready' } })).toBe(false);
  expect(holdsDuringStartup(true, { lifecycle: 'running' })).toBe(false);
  expect(holdsDuringStartup(true, { lifecycle: 'ended', startup: { ...running, state: 'running' } })).toBe(false);
  expect(holdsDuringStartup(false, initializing)).toBe(false);
});

test('RFC-024：七段步骤条——进程已拉起、界面还没画出时步骤条仍盖着终端，状态条显示「CLI 初始化」', async () => {
  const f = fakeChannel(), terminal = base();
  const initializing: StartupProgress = { ...running, stages: [...running.stages.slice(0, 3),
    { kind: 'prepare', state: 'skipped', startedAt: at(4.5), endedAt: at(4.5), durationMs: 0 },
    { kind: 'agent', state: 'succeeded', startedAt: at(4.5), endedAt: at(6), durationMs: 1500 },
    { kind: 'interface', state: 'running', startedAt: at(6), detail: '进程已拉起，等待 CLI 画出界面' }, { kind: 'ready', state: 'pending' }] };
  page = await renderElement(<Harness initial={{ ...terminal, lifecycle: 'running', startup: initializing }} channel={f.channel} />, messages);
  expect(page.host.querySelector('section[data-state="running"]')).not.toBeNull();
  expect([...page.host.querySelectorAll('li')]).toHaveLength(7);
  expect(page.host.querySelector('[role="status"]')!.textContent).toContain('启动中 6/7 · CLI 初始化（等待界面） · 进程已拉起，等待 CLI 画出界面');
});
