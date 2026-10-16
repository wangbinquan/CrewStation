import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { useState } from 'react';
import { AgentInstanceDtoSchema } from '@crewstation/contracts';
import { useBotSelection } from '../features/dev-session/hooks/useBotSelection';
import { renderElement } from './renderElement';
import { activityTaskId, activityTime } from './agentActivityFixture';

let view: Awaited<ReturnType<typeof renderElement>> | undefined;
afterEach(() => { view?.unmount(); view = undefined; sessionStorage.clear(); });
const agents = ['first', 'second'].map(agentId => AgentInstanceDtoSchema.parse({ agentId, taskId: activityTaskId, compute: 'standard', permission: 'edit', state: 'awaiting-input', startedAt: activityTime }));
function Selection() {
  const [scope, setScope] = useState(['user', 'project', 'task']);
  const selected = useBotSelection(agents, scope[0]!, scope[1]!, scope[2]!);
  return <><output>{selected.selected?.agentId ?? 'empty'}</output>
    <button onClick={() => selected.select('second')}>选择第二条</button>
    {['user', 'project', 'task'].map((name, index) => <button key={name} onClick={() => setScope(current => current.map((value, at) => at === index ? `${name}-other` : value))}>{name}</button>)}
    <button onClick={() => setScope(['user', 'project', 'task'])}>原范围</button>
  </>;
}
const chosen = () => view!.host.querySelector('output')?.textContent;

test('恢复选择按用户、项目和开发会话隔离，切回原范围仍是原对话', async () => {
  view = await renderElement(<Selection />, {}); await view.click('选择第二条');
  for (const scope of ['user', 'project', 'task']) {
    await view.click(scope); expect(chosen()).toBe('first');
    await view.click('原范围'); expect(chosen()).toBe('second');
  }
});

test('保存的对话已不可用时不静默替换成另一条历史；用户仍可重新选择', async () => {
  sessionStorage.setItem('cs-bot-selection:user:project:task', 'missing');
  view = await renderElement(<Selection />, {}); expect(chosen()).toBe('empty');
  await view.click('选择第二条'); expect(chosen()).toBe('second');
});

test('无效的存储值降级为默认选择', async () => {
  sessionStorage.setItem('cs-bot-selection:user:project:task', 'bad\nvalue');
  view = await renderElement(<Selection />, {}); expect(chosen()).toBe('first');
});

test('浏览器拒绝读写存储时聊天仍可切换', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')!;
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get() { throw new Error('Storage disabled'); } });
  try {
    view = await renderElement(<Selection />, {}); expect(chosen()).toBe('first');
    await view.click('选择第二条'); expect(chosen()).toBe('second');
  } finally { Object.defineProperty(globalThis, 'sessionStorage', descriptor); }
});
