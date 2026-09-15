import './domSetup';
import { expect, test } from 'bun:test';
import { act } from 'react';
import type { ComputeProfileInput } from '@crewstation/api-client';
import { ComputeProfileForm } from '../features/admin/components/ComputeProfileForm';
import { messages } from '../features/admin/i18n/zh-CN';
import { renderElement } from './renderElement';

test('管理员选择每窗资源套餐，初始显示资源与配额说明，提交携带套餐名', async () => {
  const submitted: ComputeProfileInput[] = [];
  const page = await renderElement(<ComputeProfileForm busy={false} onSubmit={(input) => submitted.push(input)} profilesUnavailable={false} taskProfiles={[{ name: 'cli-large', cpu: '2', memory: '4Gi', storage: '2Gi', description: '' }]} />, messages);
  try {
    expect(page.text()).toContain('占用一个项目并发额度'); expect(page.text()).toContain('cli-large · CPU 2 · 4Gi');
    const field = (label: string) => [...page.host.querySelectorAll('label')].find((node) => node.firstElementChild?.textContent === label)!.querySelector<HTMLInputElement | HTMLSelectElement>('input,select')!;
    for (const [label, value] of [['档位名', 'parallel'], ['模型', 'opencode/big-pickle'], ['每个 CLI 的资源套餐', 'cli-large']]) {
      const node = field(label!);
      await act(async () => { node.focus(); Object.getOwnPropertyDescriptor(node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(node, value);
        node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); node.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true })); });
    }
    await act(async () => { page.host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(submitted).toEqual([expect.objectContaining({ name: 'parallel', model: 'opencode/big-pickle', taskProfile: 'cli-large' })]);
  } finally { page.unmount(); }
});
