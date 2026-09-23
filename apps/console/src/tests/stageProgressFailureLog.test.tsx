import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { messages } from '../app/i18n/zh-CN';
import { StageProgress } from '../shared/ui/progress/StageProgress';
import type { Progress } from '../shared/ui/progress/stageProgressView';
import { awaitingFailureLog, FAILURE_LOG_WAIT_MS, progressPollMs } from '../shared/ui/progress/stageProgressView';
import { renderElement } from './renderElement';

const at = (second: number) => new Date(Date.parse('2026-09-23T08:08:40.000Z') + second * 1000).toISOString();
/** 启动前步骤在 +0.5 秒失败；日志由回收流程补上，比「失败」晚到。observedAt 是服务器读取这份进度的时刻。 */
const failed = (observed: number, logTail?: string): Progress => ({
  state: 'failed', startedAt: at(-4), endedAt: at(0.5), observedAt: at(observed),
  stages: [
    { kind: 'queue', state: 'succeeded', startedAt: at(-4), endedAt: at(-3), durationMs: 1000 },
    { kind: 'prepare', state: 'failed', startedAt: at(-1), endedAt: at(0.5), count: { done: 1, total: 2 }, error: { code: 'before-start-failed', message: '启动前步骤「安装项目依赖」失败：脚本退出码 1' }, ...(logTail ? { logTail } : {}) },
    { kind: 'agent', state: 'pending' }, { kind: 'ready', state: 'pending' },
  ],
});
const running: Progress = { state: 'running', startedAt: at(0), observedAt: at(1), stages: [{ kind: 'queue', state: 'running', startedAt: at(0) }] };

let rendered: Awaited<ReturnType<typeof renderElement>> | undefined;
afterEach(() => { rendered?.unmount(); rendered = undefined; });

test('刚失败、日志还没补上：失败后 20 秒内（按服务器时间）继续每秒读，日志到了或超过 20 秒就回到常规间隔', () => {
  expect(FAILURE_LOG_WAIT_MS).toBe(20_000);
  expect(awaitingFailureLog(failed(1))).toBe(true);
  expect(awaitingFailureLog(failed(20.4))).toBe(true);
  expect(awaitingFailureLog(failed(20.5))).toBe(false);
  expect(awaitingFailureLog(failed(1, '{"level":"warn","msg":"before-start step failed"}'))).toBe(false);
  expect(awaitingFailureLog(running)).toBe(false);
  expect(awaitingFailureLog(undefined)).toBe(false);
  // 没有时间可比（旧数据）就不等。
  expect(awaitingFailureLog({ ...failed(1), observedAt: undefined })).toBe(false);
  // 失败段没写结束时间时用整体的结束时间。
  expect(awaitingFailureLog({ ...failed(3), stages: failed(3).stages.map((stage) => (stage.state === 'failed' ? { ...stage, endedAt: undefined } : stage)) })).toBe(true);
  expect(progressPollMs([undefined, failed(2)], 1000, 10_000)).toBe(1000);
  expect(progressPollMs([running], 1000, 10_000)).toBe(1000);
  expect(progressPollMs([failed(30), undefined], 1000, 10_000)).toBe(10_000);
  expect(progressPollMs([], 1000, 10_000)).toBe(10_000);
});

test('展开日志：还在等日志时写「正在收集容器日志」，等不到了才是使用方给的「没有留下日志」说明，日志到了显示日志', async () => {
  const opened = async (progress: Progress) => {
    rendered?.unmount();
    rendered = await renderElement(<StageProgress progress={progress} emptyLogText="执行容器没有留下日志（容器没有启动，或者日志为空），原因见上。" logLabel="查看执行容器日志" />, {});
    await rendered.click('查看执行容器日志');
    return rendered;
  };
  expect((await opened(failed(1))).text()).toContain(messages['ui.progress.logPending']);
  const late = (await opened(failed(25))).text();
  expect(late).toContain('执行容器没有留下日志');
  expect(late).not.toContain(messages['ui.progress.logPending']);
  expect((await opened(failed(3, '{"level":"warn","msg":"before-start step failed"}'))).host.querySelector('pre')?.textContent).toContain('before-start step failed');
});
