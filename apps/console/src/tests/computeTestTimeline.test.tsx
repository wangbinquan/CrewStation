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
  { id: 'step:claude-settings', kind: 'step', stepId: '01a0bf5d-8f4b-7e58-8d8a-6b38a70679a1', name: 'Claude settings.json', state: 'failed', durationMs: 7, exitCode: 1,
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
      // 之前的测试记录（镜像 → Runner 握手 → … → 启动 CLI）照原名称显示（RFC-022 D8）。
      for (const part of ['启动前步骤失败：定位到失败的步骤修改后再保存。', '拉取镜像', 'Runner 握手', 'Claude settings.json', '启动 CLI', '模型轮次', 'file_path_in_use', '目标文件已存在且内容不同', '退出码 1', 'refusing to overwrite settings.json', '已跳过', '1.2 秒']) expect(text).toContain(part);
      expect([...view.host.querySelectorAll('li')].map((li) => li.getAttribute('data-state'))).toEqual(['succeeded', 'succeeded', 'failed', 'skipped', 'skipped']);
      for (const part of [testIdOf(1), TASK_ID, 'registry.cs.local/runtimes/claude:2.1', DIGEST, 'shell 5.2', '2.1.4']) expect(text).toContain(part);
      expect(view.host.querySelector('details > summary')?.textContent).toBe('查看测试环境与版本');
      expect(text).toContain('针对修订 1（c0ffee00c0ff）· 保存后自动测试');
      await view.click('定位到步骤');
      expect(located).toEqual(['01a0bf5d-8f4b-7e58-8d8a-6b38a70679a1']);
    } finally { view.unmount(); }
  });

  test('RFC-022：前三段与公共启动进度同名（排队分配容器、容器启动中、等待连接），「启动 CLI」改为「Agent 启动中」；进行中的段带细节', async () => {
    const stages = [
      { id: 'queue', kind: 'queue', name: '排队分配容器', state: 'succeeded', durationMs: 300 },
      { id: 'container', kind: 'container', name: '容器启动中（调度、拉取镜像）', state: 'succeeded', durationMs: 4200, detail: '已调度到节点 n1 · 镜像已拉取（用时 3.1s） · 创建容器' },
      { id: 'connect', kind: 'connect', name: '容器已启动，等待连接', state: 'succeeded', durationMs: 600, detail: 'Runner 协议 3' },
      { id: 'agent', kind: 'agent', name: 'Agent 启动中', state: 'running' },
      { id: 'model', kind: 'model', name: '真实模型轮次', state: 'pending' },
    ];
    const view = await renderPanel(profileTest({ state: 'running', outcome: undefined, stages }));
    try {
      const rows = [...view.host.querySelectorAll('li')];
      expect(rows.map((li) => li.getAttribute('data-state'))).toEqual(['succeeded', 'succeeded', 'succeeded', 'running', 'pending']);
      expect(rows.map((li) => li.querySelector('span:nth-child(2)')!.firstChild!.textContent)).toEqual(['排队分配容器', '容器启动中（调度、拉取镜像）', '容器已启动，等待连接', 'Agent 启动中', '真实模型轮次']);
      expect(rows[1]!.textContent).toContain('已调度到节点 n1 · 镜像已拉取（用时 3.1s）');
      expect(rows[2]!.textContent).toContain('Runner 协议 3');
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
      expect(running.text()).toContain('测试中'); expect(running.text()).toContain('手动测试'); expect(running.text()).toContain('（进行中）');
      expect(running.button('重新测试').disabled).toBe(true);
      expect(running.text()).not.toContain('通过：');
    } finally { running.unmount(); }
  });
});
