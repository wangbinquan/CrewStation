import { describe, expect, test } from 'bun:test';
import type { NativeTerminalDto } from '@crewstation/contracts';
import { isLiveTerminal, newGroup, normalizeGroups, reconcileTerminals } from '../features/dev-session/model/layout/terminalGroups';
import { isStoppingTerminal, withRecordPhases } from '../features/dev-session/model/native/terminalPhase';
import { activityFixture } from './agentActivityFixture';
import { resourceRecord } from './resourceRecordFixture';

// RFC-025 设计 §10：开发页 CLI 标签的结束与失败以资源台账为准，启动与运行中的细节仍按名册；没有记录的照旧用名册。
const base = activityFixture().terminal;
const cli = (name: string, lifecycle: NativeTerminalDto['lifecycle'] = 'running'): NativeTerminalDto => ({ ...base, agentId: `agent-${name}`, terminalId: `terminal-${name}`, lifecycle });
const execution = (terminal: string, phase: Parameters<typeof resourceRecord>[0]['phase'], createdAt = '2026-09-23T12:00:00.000Z') =>
  resourceRecord({ id: `01a0bf5d-8f4b-7e1e-8dde-${terminal.padStart(12, '0')}`, kind: 'agent-execution', purpose: 'development-cli', phase, display: { terminal: `terminal-${terminal}` }, createdAt });

describe('名册与台账合并', () => {
  test('结束中带上阶段、lifecycle 仍按名册；已结束记为 ended（名册里的失败保留，重试入口在它上面）；失败即失败', () => {
    const merged = withRecordPhases([cli('a'), cli('b'), cli('c', 'failed'), cli('d'), cli('e', 'starting')], [execution('a', 'stopping'), execution('b', 'stopped'), execution('c', 'stopped'), execution('d', 'failed'), execution('e', 'ready')])!;
    expect(merged.map((t) => [t.terminalId, t.lifecycle, t.phase])).toEqual([
      ['terminal-a', 'running', 'stopping'], ['terminal-b', 'ended', 'stopped'], ['terminal-c', 'failed', 'stopped'], ['terminal-d', 'failed', 'failed'],
      // RFC-024：台账说已就绪、名册说还在启动（CLI 界面还没画出来），启动细节照名册。
      ['terminal-e', 'starting', 'ready'],
    ]);
    expect(isStoppingTerminal(merged[0])).toBe(true); expect(isStoppingTerminal(merged[1])).toBe(false); expect(isStoppingTerminal(undefined)).toBe(false);
  });
  test('没有记录的（台账接上之前开的）与台账还没读到时，名册原样；同一终端取最新的执行记录', () => {
    const roster = [cli('a'), cli('z')];
    expect(withRecordPhases(roster, undefined)).toBe(roster); expect(withRecordPhases(undefined, [])).toBeUndefined();
    expect(withRecordPhases(roster, [execution('a', 'stopped'), { ...execution('a', 'ready', '2026-09-23T13:00:00.000Z'), id: '01a0bf5d-8f4b-7e1e-8dde-0000000000ff' }])!.map((t) => t.phase)).toEqual(['ready', undefined]);
  });
  test('在运行：有阶段的按阶段（结束中不算），没有的按名册；与名册对账时结束中、已结束的都不开新标签', () => {
    expect(isLiveTerminal({ lifecycle: 'running', phase: 'stopping' })).toBe(false);
    expect(isLiveTerminal({ lifecycle: 'running', phase: 'degraded' })).toBe(true);
    expect(isLiveTerminal({ lifecycle: 'ended', phase: 'ready' })).toBe(true);
    expect(isLiveTerminal({ lifecycle: 'unknown' })).toBe(true); expect(isLiveTerminal(undefined)).toBe(true);
    const group = '01a0bf5d-8f4b-7001-8abc-000000000001';
    const layout = normalizeGroups({ activeTabId: group, tabs: [newGroup(group, '一', [])], hiddenTerminalIds: [], view: 'cli', previewAlongside: false, previewRatio: 0.45, selectedTerminalId: null, maximizedTerminalId: null }, () => group);
    const next = reconcileTerminals(layout, withRecordPhases([cli('a'), cli('b'), cli('c')], [execution('a', 'stopping'), execution('b', 'stopped')])!);
    expect(next.tabs[0]!.paneOrder).toEqual(['terminal-c']); expect(next.hiddenTerminalIds).toEqual(['terminal-a', 'terminal-b']);
  });
});
