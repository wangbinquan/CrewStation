import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import type { AgentEvent } from '@crewstation/contracts';
import { BotTranscript } from '../features/dev-session/components/bot/BotTranscript';
import { appendAgentEvents } from '../features/dev-session/model/agentTranscript';
import { messages } from '../features/dev-session/i18n/zh-CN';
import { DialogHost } from '../shared/ui/dialog/DialogHost';
import { renderElement } from './renderElement';

let view: Awaited<ReturnType<typeof renderElement>> | undefined;
afterEach(() => { view?.unmount(); view = undefined; });
const transcript = (events: readonly Partial<AgentEvent>[]) => appendAgentEvents({}, events.map((event, index) => ({
  agentId: 'bot', seq: index + 1, at: '2026-10-15T12:00:00.000Z', type: 'text' as const, ...event,
}))).bot!;
async function show(events: readonly Partial<AgentEvent>[]) {
  view = await renderElement(<DialogHost><BotTranscript lines={transcript(events)} running={false} hasConversation onSuggestion={() => {}} /></DialogHost>, messages);
  await act(async () => view!.host.querySelector('summary')?.click());
  return view;
}

test('真实 OpenCode tool-start 的命令直接可见，完整参数和结果进入统一弹窗，回答不混入工具信息', async () => {
  const command = 'cd /work && bun test 2>&1 | tail -40';
  const tool = { name: 'bash', callId: 'call-snake', input: { command, timeout: 30000 }, output: '32 pass\n0 fail' };
  const rendered = await show([{ type: 'tool-start', tool }, { text: '验证完成。' }]);
  const records = rendered.host.querySelector('details')!;
  expect(records.textContent).toContain(command);
  expect(records.textContent).not.toContain(tool.output);
  expect(rendered.host.querySelector('article')?.textContent).toBe('Crew Bot验证完成。');
  await rendered.click('查看详情');
  const dialog = document.querySelector<HTMLDialogElement>('dialog[data-cs-dialog]')!;
  expect(dialog?.open).toBe(true);
  expect(records.contains(dialog)).toBe(false);
  expect(dialog.textContent).toContain(command);
  expect(dialog.textContent).toContain(JSON.stringify(tool.input, null, 2));
  expect(dialog.textContent).toContain(tool.output);
  expect(dialog.textContent).toContain(tool.callId);
});

test('长列表末条的完整多行命令和输出不丢失；Esc 关闭恢复触发焦点及列表上下文', async () => {
  const command = `cat <<'EOF'\n${'long command\n'.repeat(100)}EOF\nprintf '<img src=x onerror=alert(1)>'`;
  const output = 'result\n'.repeat(2000);
  const rendered = await show(Array.from({ length: 80 }, (_, index) => ({ type: 'tool-end' as const,
    tool: { name: 'bash', input: { command: index === 79 ? command : `echo ${index}` }, output },
  })));
  const log = rendered.host.querySelector<HTMLElement>('[role="log"]')!;
  log.scrollTop = 2400;
  const trigger = [...rendered.host.querySelectorAll<HTMLButtonElement>('button[aria-label="查看 bash 执行详情"]')].at(-1)!;
  expect(Boolean(trigger)).toBe(true);
  trigger.focus();
  await act(async () => trigger.click());
  const dialog = document.querySelector<HTMLDialogElement>('dialog[data-cs-dialog]')!;
  expect(dialog?.open).toBe(true);
  expect([...dialog.querySelectorAll('pre')].some(pre => pre.textContent === command)).toBe(true);
  expect([...dialog.querySelectorAll('pre')].some(pre => pre.textContent === output)).toBe(true);
  expect(dialog.querySelectorAll('img')).toHaveLength(0);
  await act(async () => dialog.dispatchEvent(new Event('cancel', { cancelable: true })));
  expect(document.querySelectorAll('dialog')).toHaveLength(0);
  expect(document.activeElement === trigger).toBe(true);
  expect(log.scrollTop).toBe(2400);
  expect(rendered.host.querySelector('details')?.open).toBe(true);
});

test('非命令工具保留嵌套参数及 false、0、null 返回值，缺失字段明确说明', async () => {
  const inputs = [{ filePath: '/work/a.ts', options: { offset: 0, enabled: false } }, 'pwd', null, undefined];
  const outputs = [false, 0, null, undefined];
  for (let index = 0; index < inputs.length; index++) {
    const rendered = await show([{ type: 'tool-end', tool: { name: 'read', input: inputs[index], output: outputs[index] } }]);
    await rendered.click('查看详情');
    const dialog = document.querySelector('dialog')!;
    const parameters = dialog.querySelector('section[aria-label="输入参数"]')!;
    const result = dialog.querySelector('section[aria-label="返回结果"]')!;
    expect(parameters.textContent).toContain(index === 3 ? '该记录未保存输入参数。' : typeof inputs[index] === 'string' ? inputs[index] as string : JSON.stringify(inputs[index], null, 2));
    expect(result.textContent).toContain(index === 3 ? '该记录未保存返回结果。' : JSON.stringify(outputs[index], null, 2));
    rendered.unmount(); view = undefined;
  }
});
