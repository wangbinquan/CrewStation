import { describe, expect, test } from 'bun:test';
import type { NativeTerminalDto } from '@crewstation/contracts';
import { withExecutionPhase } from './terminalPhase';

const item = (lifecycle: NativeTerminalDto['lifecycle']) => ({ lifecycle, agentId: 'agt-1' }) as unknown as NativeTerminalDto;

describe('名册的 lifecycle 由台账推导（RFC-025 §11.2）', () => {
  test('台账已结束是 ended（Runner 报的 failed 照旧），失败是 failed；结束中、运行中、启动中按 Runner 的说法，都带上 phase', () => {
    expect(withExecutionPhase(item('running'), 'stopped')).toMatchObject({ lifecycle: 'ended', phase: 'stopped' });
    expect(withExecutionPhase(item('unknown'), 'stopped').lifecycle).toBe('ended');
    expect(withExecutionPhase(item('failed'), 'stopped').lifecycle).toBe('failed');
    expect(withExecutionPhase(item('running'), 'failed')).toMatchObject({ lifecycle: 'failed', phase: 'failed' });
    expect(withExecutionPhase(item('running'), 'stopping')).toMatchObject({ lifecycle: 'running', phase: 'stopping' });
    expect(withExecutionPhase(item('starting'), 'ready')).toMatchObject({ lifecycle: 'starting', phase: 'ready' });
    expect(withExecutionPhase(item('running'), undefined)).toEqual(item('running'));
  });
});
