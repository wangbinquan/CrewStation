import { expect, test } from 'bun:test';
import { messages } from '../features/dev-session/i18n/zh-CN';
import { entryProgress } from '../features/dev-session/model/connection/entryProgress';
import type { EntryStep } from '../features/dev-session/model/connection/entryProgress';
import { INITIAL_STREAM_STATE } from '../features/dev-session/model/taskStreamSocket';
import type { StreamState } from '../features/dev-session/model/taskStreamSocket';
import { translate } from '../shared/lib/i18n';
import type { Progress } from '../shared/ui/progress/stageProgressView';

const t = (key: string, values?: Record<string, string | number>) => translate(messages, key, values);
const T0 = Date.parse('2026-09-23T12:00:00.000Z');
const iso = (offset: number) => new Date(T0 + offset).toISOString();
const states = (progress: Progress<EntryStep>) => progress.stages.map((stage) => stage.state);
const ready = { layout: true, terminals: true, profiles: true };
const open: StreamState = { ...INITIAL_STREAM_STATE, status: 'open', openedAt: T0 + 1200 };

test('进页四步：读会话 → 页面通道 → 开发环境 → 个人布局与 CLI 标签，每一步从上一步完成的时刻算起', () => {
  const reading = entryProgress({ enteredAt: T0 }, t);
  expect(states(reading)).toEqual(['running', 'pending', 'pending', 'pending']);
  expect(reading.startedAt).toBe(iso(0)); expect(reading.stages[0]).toMatchObject({ kind: 'session', startedAt: iso(0) });
  const connecting = entryProgress({ enteredAt: T0, sessionAt: T0 + 200, stream: INITIAL_STREAM_STATE, health: 'browser' }, t);
  expect(states(connecting)).toEqual(['succeeded', 'running', 'pending', 'pending']);
  expect(connecting.stages[0]).toMatchObject({ endedAt: iso(200), durationMs: 200 }); expect(connecting.stages[1]).toMatchObject({ startedAt: iso(200) });
  expect(connecting.stages[1]?.detail).toBeUndefined();
  const unanswered = entryProgress({ enteredAt: T0, sessionAt: T0 + 200, stream: open, health: 'unknown', workspace: ready }, t);
  expect(states(unanswered)).toEqual(['succeeded', 'succeeded', 'running', 'pending']);
  expect(unanswered.stages[1]).toMatchObject({ durationMs: 1000 }); expect(unanswered.stages[2]).toMatchObject({ startedAt: iso(1200), detail: '页面已连接，开发环境尚未响应；连上后自动继续' });
  const connected: StreamState = { ...open, runnerConnected: true, runnerAt: T0 + 1500 };
  const restoring = entryProgress({ enteredAt: T0, sessionAt: T0 + 200, stream: connected, health: 'ready', workspace: { layout: false, terminals: true, profiles: true } }, t);
  expect(states(restoring)).toEqual(['succeeded', 'succeeded', 'succeeded', 'running']);
  expect(restoring.stages[2]).toMatchObject({ durationMs: 300 }); expect(restoring.stages[3]).toMatchObject({ startedAt: iso(1500), detail: '正在恢复个人布局…' });
  expect(entryProgress({ enteredAt: T0, sessionAt: T0, stream: connected, health: 'ready', workspace: { ...ready, terminals: false } }, t).stages[3]?.detail).toBe('正在读取 CLI 标签…');
  expect(entryProgress({ enteredAt: T0, sessionAt: T0, stream: connected, health: 'ready', workspace: { ...ready, profiles: false } }, t).stages[3]?.detail).toBe('正在读取可用算力档位…');
  expect(states(entryProgress({ enteredAt: T0, sessionAt: T0 + 200, stream: connected, health: 'ready', workspace: ready }, t))).toEqual(['succeeded', 'succeeded', 'succeeded', 'succeeded']);
  // Runner 先于页面通道报「已连上」（streamReady 先记环境、再把通道置为打开）时，环境这一步记 0 秒而不是负数。
  expect(entryProgress({ enteredAt: T0, sessionAt: T0, stream: { ...connected, runnerAt: T0 + 1100 }, health: 'ready', workspace: ready }, t).stages[2]).toMatchObject({ durationMs: 0 });
});

test('页面通道重连写明次数与原因；开发环境在准备、恢复、收尾时写明还在等什么；只有就绪才算过了第三步', () => {
  const reconnecting = entryProgress({ enteredAt: T0, sessionAt: T0, stream: { ...INITIAL_STREAM_STATE, status: 'reconnecting', attempt: 2, error: '连接出错' }, health: 'browser' }, t);
  expect(reconnecting.stages[1]?.detail).toBe('第 2 次重连 · 连接出错');
  expect(entryProgress({ enteredAt: T0, sessionAt: T0, stream: open, health: 'starting' }, t).stages[2]?.detail).toBe('平台正在准备开发环境');
  expect(entryProgress({ enteredAt: T0, sessionAt: T0, stream: open, health: 'recovering' }, t).stages[2]?.detail).toBe('正在恢复开发环境，工作卷保留');
  const draining = entryProgress({ enteredAt: T0, sessionAt: T0, stream: { ...open, runnerConnected: true, runnerAt: T0, runnerState: 'draining' }, health: 'stopping' }, t).stages[2];
  expect(draining).toMatchObject({ state: 'running', warning: 'TaskRunner 正在收尾（draining）：不再接受新工作，容器随后会停止。' });
  // 页面通道没打开时环境一步不开始，哪怕环境自报已连上（重连途中的旧状态）。
  expect(states(entryProgress({ enteredAt: T0, sessionAt: T0, stream: { ...INITIAL_STREAM_STATE, runnerConnected: true }, health: 'browser', workspace: ready }, t))).toEqual(['succeeded', 'running', 'pending', 'pending']);
});
