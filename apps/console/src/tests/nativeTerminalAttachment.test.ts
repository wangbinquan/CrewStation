import { describe, expect, test } from 'bun:test';
import type { RunnerEvent, TerminalSnapshot } from '@crewstation/contracts';
import type { TaskStreamCommandInput } from '@crewstation/api-client';
import { NativeTerminalAttachment } from '../features/dev-session/model/native/nativeTerminalAttachment';

const runnerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function fixture() {
  let receive: (event: RunnerEvent, seq: number) => void = () => {};
  const calls: TaskStreamCommandInput[] = [], writes: string[] = [], sizes: number[][] = [];
  const snapshots: ((snapshot: TerminalSnapshot) => void)[] = [];
  const attachment = new NativeTerminalAttachment({ subscribe: (listener) => { receive = listener; return () => { receive = () => {}; }; }, send: async (command) => {
    calls.push(command);
    if (command.type === 'attachTerminal') return new Promise<TerminalSnapshot>((resolve) => snapshots.push(resolve));
    if (command.type === 'claimTerminalControl') return { controlled: true, expiresAt: '2026-09-13T00:00:30.000Z' };
    return {};
  } }, 'cli-a', runnerId, { restore: async (snapshot) => { writes.length = 0; writes.push(snapshot.data); }, write: (data) => writes.push(data), resize: (cols, rows) => sizes.push([cols, rows]) });
  attachment.start();
  return { attachment, calls, writes, sizes, emit: (seq: number, data: string) => receive({ kind: 'terminalOutput', terminalId: 'cli-a', runnerId, terminalSeq: seq, data }, seq),
    resize: (seq: number) => receive({ kind: 'terminalResized', terminalId: 'cli-a', runnerId, terminalSeq: seq, cols: 100, rows: 30 }, seq),
    snapshot: (seq: number, data: string) => snapshots.shift()!({ terminalId: 'cli-a', runnerId, throughSeq: seq, data, cols: 80, rows: 24, truncated: true, scrollbackLimit: 500 }),
  };
}

describe('原生终端附着', () => {
  test('快照期间缓冲；重叠事件去重，后续输出与尺寸保持顺序；卸载只 detach', async () => {
    const f = fixture(); f.attachment.connect();
    f.emit(2, 'already in snapshot'); f.emit(3, 'next'); f.resize(4);
    f.snapshot(2, 'screen'); await f.attachment.refresh();
    expect(f.writes).toEqual(['screen', 'next']); expect(f.sizes).toEqual([[100, 30]]);
    expect(f.attachment.getState()).toMatchObject({ phase: 'ready', controlled: false, truncated: true });
    f.attachment.input('ignored without control');
    await f.attachment.claim(); f.attachment.input('one'); f.attachment.resize(120, 40);
    f.attachment.dispose();
    expect(f.calls.map((c) => c.type)).toEqual(['attachTerminal', 'claimTerminalControl', 'terminalInput', 'terminalResize', 'detachTerminal']);
  });
  test('断线丢弃过期快照；重连与序号缺口只重新附着，不启动或重发输入', async () => {
    const f = fixture(); f.attachment.connect();
    const obsolete = f.attachment.refresh();
    f.attachment.disconnect(); f.attachment.input('offline'); f.attachment.connect();
    f.snapshot(0, 'obsolete'); await obsolete;
    expect(f.writes).toEqual([]);
    f.snapshot(10, 'restored'); await f.attachment.refresh();
    f.emit(12, 'missed 11');
    expect(f.attachment.getState().phase).toBe('attaching');
    f.snapshot(12, 'repaired'); await f.attachment.refresh();
    expect(f.writes).toEqual(['repaired']);
    expect(f.calls.every((c) => c.type === 'attachTerminal')).toBe(true);
    f.attachment.dispose();
  });
});
