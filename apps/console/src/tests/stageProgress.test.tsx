import './domSetup';
import { afterEach, expect, spyOn, test } from 'bun:test';
import { act } from 'react';
import { messages } from '../app/i18n/zh-CN';
import { translate } from '../shared/lib/i18n';
import { StageProgress, StageSummary } from '../shared/ui/progress/StageProgress';
import type { Progress, ProgressStage } from '../shared/ui/progress/stageProgressView';
import { clockSkew, formatDuration, stageElapsed, stageLabel, stagePosition, stampReceived, totalElapsed } from '../shared/ui/progress/stageProgressView';
import { renderElement } from './renderElement';

const t = (key: string, values?: Record<string, string | number>) => translate(messages, key, values);
const SERVER = Date.parse('2026-09-23T03:00:10.000Z');
const at = (second: number) => new Date(Date.parse('2026-09-23T03:00:00.000Z') + second * 1000).toISOString();
const cli: Progress = {
  state: 'running', startedAt: at(0), observedAt: new Date(SERVER).toISOString(),
  stages: [
    { kind: 'queue', state: 'succeeded', startedAt: at(0), endedAt: at(0.6), durationMs: 600 },
    { kind: 'container', state: 'succeeded', startedAt: at(0.6), endedAt: at(3.9), durationMs: 3300, detail: '已调度到节点 docker-desktop · 镜像节点上已有 · 创建容器' },
    { kind: 'connect', state: 'succeeded', startedAt: at(3.9), endedAt: at(4.5), durationMs: 600 },
    { kind: 'prepare', state: 'running', startedAt: at(6), count: { done: 1, total: 2 }, detail: '写入 settings.json' },
    { kind: 'agent', state: 'pending' }, { kind: 'ready', state: 'pending' },
  ],
};

let rendered: Awaited<ReturnType<typeof renderElement>> | undefined;
let clock: ReturnType<typeof spyOn> | undefined;
afterEach(() => { rendered?.unmount(); rendered = undefined; clock?.mockRestore(); clock = undefined; });
/** 本机时钟比服务器慢 30 秒：取数时记下的收到时刻也慢 30 秒，计时仍按服务器时间算。 */
const slowClock = () => { clock = spyOn(Date, 'now').mockReturnValue(SERVER - 30_000); };
const slow = stampReceived(cli, SERVER - 30_000)!;

test('视图模型：时钟偏差、各段用时、总用时、当前段位置、段名与用时写法', () => {
  expect(clockSkew(new Date(SERVER).toISOString(), SERVER - 30_000)).toBe(30_000);
  expect(clockSkew(new Date(SERVER).toISOString(), SERVER + 30_000)).toBe(-30_000);
  expect(clockSkew(undefined, SERVER)).toBe(0);
  expect(clockSkew('not-a-date', SERVER)).toBe(0);
  const running = cli.stages[3]!;
  // 本机慢 30 秒或快 30 秒，校正后都是服务器上的 4 秒。
  expect(stageElapsed(running, SERVER - 30_000, 30_000)).toBe(4000);
  expect(stageElapsed(running, SERVER + 30_000, -30_000)).toBe(4000);
  expect(stageElapsed({ kind: 'agent', state: 'running', startedAt: at(20) }, SERVER, 0)).toBe(0);
  expect(stageElapsed(cli.stages[0]!, SERVER, 0)).toBe(600);
  expect(stageElapsed({ kind: 'queue', state: 'skipped', startedAt: at(0), endedAt: at(2) }, SERVER, 0)).toBe(2000);
  expect(stageElapsed(cli.stages[4]!, SERVER, 0)).toBeUndefined();
  expect(totalElapsed(cli, SERVER - 30_000, 30_000)).toBe(10_000);
  expect(totalElapsed({ ...cli, state: 'ready', endedAt: at(10.5) }, SERVER + 99_000, 0)).toBe(10_500);
  expect(stagePosition(cli)).toMatchObject({ index: 4, total: 6, stage: { kind: 'prepare' } });
  expect(stagePosition({ ...cli, stages: [] })).toEqual({ index: 0, total: 0 });
  expect(stampReceived(cli, 42)).toEqual({ ...cli, receivedAt: 42 });
  expect(stampReceived(undefined, 42)).toBeUndefined();
  expect([0, 640, 9_990, 10_000, 59_999, 60_000, 185_000].map((ms) => formatDuration(t, ms))).toEqual(['0.0 秒', '0.6 秒', '9.9 秒', '10 秒', '59 秒', '1 分 00 秒', '3 分 05 秒']);
  expect(stageLabel(t, running)).toBe('准备环境（启动前步骤 1/2）');
  expect(stageLabel(t, { kind: 'prepare', state: 'pending' })).toBe('准备环境（启动前步骤）');
  expect(stageLabel(t, { kind: 'checkout', state: 'running', subject: 'feature/x' })).toBe('检出代码（分支 feature/x）');
  expect(['queue', 'replace', 'container', 'connect', 'agent', 'ready'].map((kind) => stageLabel(t, { kind, state: 'pending' })))
    .toEqual(['排队分配容器', '替换旧容器', '容器启动中（调度、拉取镜像）', '容器已启动，等待连接', 'Agent 启动中', '已就绪']);
});

test('步骤条：完成的打勾带用时与细节，当前段带细节与按服务器时间的计时，未开始的空心；标题带已用时间', async () => {
  slowClock();
  rendered = await renderElement(<StageProgress progress={slow} title="正在启动 CLI · volc-glm-5-2" />, {});
  const items = [...rendered.host.querySelectorAll('li')];
  expect(items.map((li) => li.getAttribute('data-state'))).toEqual(['succeeded', 'succeeded', 'succeeded', 'running', 'pending', 'pending']);
  expect(items.map((li) => li.querySelector('[aria-hidden="true"]')!.textContent)).toEqual(['✓', '✓', '✓', '●', '○', '○']);
  expect(items[1]!.textContent).toContain('3.3 秒');
  expect(items[1]!.textContent).toContain('已调度到节点 docker-desktop');
  expect(items[3]!.getAttribute('aria-current')).toBe('step');
  expect(items[3]!.textContent).toContain('准备环境（启动前步骤 1/2）');
  expect(items[3]!.textContent).toContain('写入 settings.json');
  expect(items[3]!.textContent).toContain('4.0 秒');
  expect(items[4]!.textContent).toBe('○Agent 启动中（未开始）');
  expect(rendered.host.querySelector('header')!.textContent).toBe('正在启动 CLI · volc-glm-5-2已用 10 秒');
  expect(rendered.host.querySelector('[aria-live="polite"]')!.textContent).toBe('准备环境（启动前步骤 1/2）');
  expect(rendered.host.querySelector('section')!.getAttribute('aria-label')).toBe('正在启动 CLI · volc-glm-5-2');
});

test('失败停在出错的那一段：原因、仍在重试的警告、使用方按钮；有日志尾部时出现「查看日志」开关', async () => {
  const failed: Progress = { ...cli, state: 'failed', endedAt: at(12), stages: [
    cli.stages[0]!,
    { kind: 'container', state: 'failed', startedAt: at(0.6), endedAt: at(12), durationMs: 11_400, warning: '镜像拉取失败（ImagePullBackOff）', error: { code: 'image-pull-failed', message: '此CLI的镜像拉取失败（ErrImagePull）' }, logTail: 'pull access denied' },
    { kind: 'connect', state: 'pending' }, { kind: 'prepare', state: 'pending' }, { kind: 'agent', state: 'pending' }, { kind: 'ready', state: 'pending' }] };
  rendered = await renderElement(<StageProgress progress={failed} title="正在启动 CLI" logLabel="查看执行容器日志" actions={<button type="button">重试</button>} />, {});
  const stage = rendered.host.querySelectorAll('li')[1]!;
  expect(stage.getAttribute('data-state')).toBe('failed');
  expect(stage.textContent).toContain('此CLI的镜像拉取失败（ErrImagePull）');
  expect(stage.textContent).toContain('镜像拉取失败（ImagePullBackOff）');
  expect(rendered.host.querySelector('[aria-current]')).toBeNull();
  expect(rendered.host.querySelector('header')!.textContent).toContain('共 12 秒');
  expect(rendered.host.querySelector('[aria-live="polite"]')!.textContent).toBe('启动失败');
  expect(rendered.button('重试')).toBeTruthy();
  const toggle = rendered.button('查看执行容器日志');
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(rendered.host.querySelector('pre')).toBeNull();
  await rendered.click('查看执行容器日志');
  expect(rendered.host.querySelector('pre')!.textContent).toBe('pull access denied');
  expect(rendered.button('查看执行容器日志').getAttribute('aria-expanded')).toBe('true');
});

test('档位测试用法：段名由使用方给，跳过的段写「已跳过」，每段下面可以放附加内容；没有日志尾部就没有开关', async () => {
  const stages: Array<ProgressStage & { name: string }> = [
    { kind: 'container', name: '容器启动中（调度、拉取镜像）', state: 'succeeded', durationMs: 1200 },
    { kind: 'step', name: '安装依赖', state: 'skipped' },
    { kind: 'model', name: '真实模型轮次', state: 'succeeded', durationMs: 65_000 },
  ];
  rendered = await renderElement(<StageProgress progress={{ state: 'ready', startedAt: at(0), endedAt: at(70), stages }} label={(stage) => stage.name} renderExtra={(stage) => (stage.kind === 'step' ? <span>定位</span> : null)} />, {});
  const items = [...rendered.host.querySelectorAll('li')];
  expect(items.map((li) => li.textContent)).toEqual(['✓容器启动中（调度、拉取镜像）（已完成）1.2 秒', '–安装依赖（已跳过）已跳过定位', '✓真实模型轮次（已完成）1 分 05 秒']);
  expect(rendered.host.querySelector('header')).toBeNull();
  expect(rendered.host.querySelector('button')).toBeNull();
});

test('状态条摘要：启动中写第几段、段名、细节或警告与计时；失败写段名与原因；就绪与取消只写结论', async () => {
  slowClock();
  rendered = await renderElement(<>
    <StageSummary progress={slow} />
    <StageSummary progress={{ ...slow, stages: [cli.stages[0]!, { kind: 'container', state: 'running', startedAt: at(8), detail: '等待调度', warning: '调度不上：0/1 nodes are available' }] }} />
    <StageSummary progress={{ ...cli, state: 'failed', stages: [{ kind: 'agent', state: 'failed', error: { code: 'agent-start-failed', message: 'spawn ENOENT' } }] }} />
    <StageSummary progress={{ ...cli, state: 'ready', stages: [{ kind: 'ready', state: 'succeeded' }] }} />
    <StageSummary progress={{ ...cli, state: 'cancelled', stages: [{ kind: 'queue', state: 'skipped' }] }} />
  </>, {});
  const lines = [...rendered.host.querySelectorAll('span')].map((span) => [span.getAttribute('data-state'), span.textContent]);
  expect(lines).toEqual([
    ['running', '启动中 4/6 · 准备环境（启动前步骤 1/2） · 写入 settings.json · 4.0 秒'],
    ['warning', '启动中 2/2 · 容器启动中（调度、拉取镜像） · 调度不上：0/1 nodes are available · 2.0 秒'],
    ['failed', '启动失败 · Agent 启动中：spawn ENOENT'],
    ['ready', '已就绪'],
    ['cancelled', '已取消'],
  ]);
});

test('进行中的计时每秒刷新；刚收到的进度比上一次走表新时以收到时刻为准', async () => {
  let now = SERVER;
  clock = spyOn(Date, 'now').mockImplementation(() => now);
  rendered = await renderElement(<StageSummary progress={cli} />, {});
  expect(rendered.text()).toContain('4.0 秒');
  now += 2000;
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1100)); });
  expect(rendered.text()).toContain('6.0 秒');
  // 走表停在 +2 秒时收到 0.5 秒后的一份：不等下一次走表，按收到的时刻算。
  rendered.unmount();
  rendered = await renderElement(<StageSummary progress={{ ...stampReceived(cli, now + 500)!, observedAt: new Date(now + 500).toISOString() }} />, {});
  expect(rendered.text()).toContain('6.5 秒');
});
