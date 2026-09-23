import { describe, expect, test } from 'bun:test';
import type { TraceEventDto } from '@crewstation/contracts';
import { messages } from '../features/traces/i18n/zh-CN';
import { describeTraceEvent } from '../features/traces/model/traceEventText';
import { translate } from '../shared/lib/i18n';

const t = (key: string, params?: Record<string, string | number>) => translate(messages, key, params);
const at = '2026-09-23T10:00:00.000Z';
const event = (e: Omit<TraceEventDto, 'seq' | 'at'>): TraceEventDto => ({ seq: 1, at, ...e });

describe('回放事件的文字', () => {
  test('Agent 事件：错误优先，其次工具（失败的注明）、文字、状态、退出码；出错与工具失败标红', () => {
    expect(describeTraceEvent(event({ kind: 'agent', type: 'tool-end', tool: { name: 'bash', isError: true } }), t)).toEqual({ kind: '工具返回', detail: 'bash · 失败', failed: true });
    expect(describeTraceEvent(event({ kind: 'agent', type: 'error', error: '额度用尽', text: '忽略' }), t)).toEqual({ kind: '出错', detail: '额度用尽', failed: true });
    expect(describeTraceEvent(event({ kind: 'agent', type: 'completed', exitCode: 0 }), t)).toEqual({ kind: '完成', detail: '退出码 0', failed: false });
    expect(describeTraceEvent(event({ kind: 'agent', type: 'thinking' }), t)).toEqual({ kind: '思考（内容不保留）', failed: false });
  });

  test('启动前步骤：状态进种类，步骤名与错误原因进内容，失败标红', () => {
    expect(describeTraceEvent(event({ kind: 'before-start', status: 'failed', text: '装依赖', error: '退出码 1' }), t)).toEqual({ kind: '启动前步骤 · 失败', detail: '装依赖 · 退出码 1', failed: true });
    expect(describeTraceEvent(event({ kind: 'before-start', status: 'succeeded' }), t)).toEqual({ kind: '启动前步骤 · 完成', failed: false });
    expect(describeTraceEvent(event({ kind: 'before-start' }), t)).toEqual({ kind: '启动前步骤', failed: false });
  });

  test('CLI 活动信号有文案就翻译，没有文案（Runner 新增的种类）原样显示；一轮失败标红', () => {
    expect(describeTraceEvent(event({ kind: 'activity', status: 'turn-completed' }), t)).toEqual({ kind: 'CLI 活动', detail: '一轮完成', failed: false });
    expect(describeTraceEvent(event({ kind: 'activity', status: 'turn-failed' }), t)).toEqual({ kind: 'CLI 活动', detail: '一轮失败', failed: true });
    expect(describeTraceEvent(event({ kind: 'activity', status: 'brand-new-signal' }), t)).toEqual({ kind: 'CLI 活动', detail: 'brand-new-signal', failed: false });
    expect(describeTraceEvent(event({ kind: 'activity' }), t)).toEqual({ kind: 'CLI 活动', failed: false });
  });

  test('终端关闭：退出码非零标红，未知退出码照实写', () => {
    expect(describeTraceEvent(event({ kind: 'terminal-closed', exitCode: 0 }), t)).toEqual({ kind: '终端关闭', detail: '退出码 0', failed: false });
    expect(describeTraceEvent(event({ kind: 'terminal-closed', exitCode: 137 }), t)).toEqual({ kind: '终端关闭', detail: '退出码 137', failed: true });
    expect(describeTraceEvent(event({ kind: 'terminal-closed', exitCode: null }), t)).toEqual({ kind: '终端关闭', detail: '退出码未知', failed: false });
  });
});
