import './domSetup';
import { describe, expect, test } from 'bun:test';
import { ProfileTestOutcomeSchema } from '@crewstation/contracts';
import type { ProfileTestDto } from '@crewstation/contracts';
import { ProfileTestPanel } from '../features/admin/components/compute/ProfileTestPanel';
import { computeMessages } from '../features/admin/i18n/compute.zh-CN';
import { messages } from '../features/admin/i18n/zh-CN';
import { DIGEST, TASK_ID, profileTest, testIdOf } from './computeProfileFixture';
import { renderElement } from './renderElement';

async function renderPanel(latest: ProfileTestDto, onLocate: (stepId: string) => void = () => {}) {
  return renderElement(<ProfileTestPanel name="claude-daily" latest={latest} dirty={false} onLocate={onLocate} />, messages);
}

const failedStep = [
  { id: 'image', kind: 'image', name: '拉取镜像', state: 'succeeded', durationMs: 1200 },
  { id: 'runner', kind: 'runner', name: 'Runner 握手', state: 'succeeded', durationMs: 40 },
  { id: 'step:claude-settings', kind: 'step', stepId: 'claude-settings', name: 'Claude settings.json', state: 'failed', durationMs: 7, exitCode: 1,
    error: { code: 'file_path_in_use', message: '目标文件已存在且内容不同' }, log: { stdoutTail: '', stderrTail: 'refusing to overwrite settings.json' } },
  { id: 'launch', kind: 'launch', name: '启动 CLI', state: 'skipped' },
  { id: 'model', kind: 'model', name: '模型轮次', state: 'skipped' },
];

describe('测试时间线（RFC-006 §8）', () => {
  test('每一种结论都给出管理员能处理的一句话；通过为成功色，其余为错误', async () => {
    for (const outcome of ProfileTestOutcomeSchema.options) {
      const view = await renderPanel(profileTest({ state: outcome === 'passed' ? 'passed' : 'failed', outcome }));
      try {
        const note = [...view.host.querySelectorAll('[role="status"], [role="alert"], p, div')].find((node) => node.textContent === computeMessages[`admin.profile.test.outcome.${outcome}`]);
        expect(note).toBeDefined();
        expect(view.text()).toContain(outcome === 'passed' ? '测试通过' : '测试失败');
      } finally { view.unmount(); }
    }
  });

  test('失败阶段写明错误码、退出码与输出尾部，后续阶段标为未执行，并能定位到出错的启动前步骤', async () => {
    const located: string[] = [];
    const view = await renderPanel(profileTest({ state: 'failed', outcome: 'before-start-failed', stages: failedStep }), (stepId) => located.push(stepId));
    try {
      const text = view.text();
      for (const part of ['启动前步骤失败：定位到失败的步骤修改后再保存。', '镜像', 'Runner', '启动前步骤', 'CLI 启动', '模型轮次', 'file_path_in_use', '目标文件已存在且内容不同', '退出码 1', 'refusing to overwrite settings.json', '未执行', '1200 ms']) expect(text).toContain(part);
      for (const part of [testIdOf(1), TASK_ID, 'registry.cs.local/runtimes/claude:2.1', DIGEST, 'shell 5.2', '2.1.4']) expect(text).toContain(part);
      expect(view.host.querySelector('details > summary')?.textContent).toBe('查看测试环境与版本');
      expect(text).toContain('针对修订 1（c0ffee00c0ff）· 保存后自动测试');
      await view.click('定位到步骤');
      expect(located).toEqual(['claude-settings']);
    } finally { view.unmount(); }
  });

  test('结果未知与已作废各有说明；进行中的测试不给结论，也不能再发起', async () => {
    const unknown = await renderPanel(profileTest({ state: 'unknown', outcome: 'environment-lost' }));
    try {
      expect(unknown.text()).toContain('结果未知'); expect(unknown.text()).toContain('不能确认启动前脚本是否已执行，也不会自动重跑');
    } finally { unknown.unmount(); }
    const superseded = await renderPanel(profileTest({ state: 'superseded', outcome: undefined }));
    try {
      expect(superseded.text()).toContain('已作废'); expect(superseded.text()).toContain('这次测试之后档位又保存了新修订，结果已作废。');
    } finally { superseded.unmount(); }
    const running = await renderPanel(profileTest({ state: 'running', outcome: undefined, trigger: 'manual', stages: [{ id: 'image', kind: 'image', name: '拉取镜像', state: 'running' }] }));
    try {
      expect(running.text()).toContain('测试中'); expect(running.text()).toContain('手动测试'); expect(running.text()).toContain('执行中');
      expect(running.button('重新测试').disabled).toBe(true);
      expect(running.text()).not.toContain('通过：');
    } finally { running.unmount(); }
  });
});
