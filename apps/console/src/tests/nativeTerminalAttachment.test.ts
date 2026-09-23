import { describe, expect, test } from 'bun:test';
import type { RunnerEvent, TerminalControl, TerminalControlState, TerminalSnapshot } from '@crewstation/contracts';
import type { TaskStreamCommandInput } from '@crewstation/api-client';
import { NativeTerminalAttachment } from '../features/dev-session/model/native/nativeTerminalAttachment';
import { StreamCommandError } from '../features/dev-session/model/streamCommandQueue';

const runnerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
interface FixtureOptions { readonly now?: () => number; readonly renewMs?: number }
function fixture(options: FixtureOptions = {}) {
  let receive: (event: RunnerEvent, seq: number) => void = () => {};
  const calls: TaskStreamCommandInput[] = [], writes: string[] = [], sizes: number[][] = [];
  const snapshots: ((snapshot: TerminalSnapshot) => void)[] = [];
  const control: { result: () => Promise<TerminalControl>; input: () => Promise<unknown> } = { result: async () => ({ controlled: true, expiresAt: '2026-09-13T00:00:30.000Z' }), input: async () => ({}) };
  const attachment = new NativeTerminalAttachment({ subscribe: (listener) => { receive = listener; return () => { receive = () => {}; }; }, send: async (command) => {
    calls.push(command);
    if (command.type === 'attachTerminal') return new Promise<TerminalSnapshot>((resolve) => snapshots.push(resolve));
    if (command.type === 'claimTerminalControl') return control.result();
    if (command.type === 'terminalInput') return control.input();
    return {};
  } }, 'cli-a', runnerId, { restore: async (snapshot) => { writes.length = 0; writes.push(snapshot.data); }, write: (data) => writes.push(data), resize: (cols, rows) => sizes.push([cols, rows]) }, options);
  attachment.start();
  return { attachment, calls, writes, sizes, control, emit: (seq: number, data: string) => receive({ kind: 'terminalOutput', terminalId: 'cli-a', runnerId, terminalSeq: seq, data }, seq),
    resize: (seq: number) => receive({ kind: 'terminalResized', terminalId: 'cli-a', runnerId, terminalSeq: seq, cols: 100, rows: 30 }, seq),
    snapshot: (seq: number, data: string, extra: Partial<TerminalSnapshot> = {}) => snapshots.shift()!({ terminalId: 'cli-a', runnerId, throughSeq: seq, data, cols: 80, rows: 24, truncated: true, scrollbackLimit: 500, ...extra }),
    pushControl: (state: TerminalControlState, seq = 100) => receive({ kind: 'terminalControl', terminalId: 'cli-a', runnerId, control: state }, seq),
  };
}
type Fixture = ReturnType<typeof fixture>;
async function ready(f: Fixture, extra: Partial<TerminalSnapshot> = {}): Promise<void> { f.attachment.connect(); f.snapshot(0, 'screen', extra); await f.attachment.refresh(); }
const zhang = { userId: 'user-zhang', name: '张三' }, li = { userId: 'user-li', name: '李四' };
const claimTypes = (f: Fixture) => f.calls.filter((c) => c.type === 'claimTerminalControl').length;

describe('原生终端附着', () => {
  test('快照期间缓冲；重叠事件去重，后续输出与尺寸保持顺序；卸载只 detach', async () => {
    const f = fixture(); f.attachment.connect();
    f.emit(2, 'already in snapshot'); f.emit(3, 'next'); f.resize(4);
    f.snapshot(2, 'screen'); await f.attachment.refresh();
    expect(f.writes).toEqual(['screen', 'next']); expect(f.sizes).toEqual([[100, 30]]);
    expect(f.attachment.getState()).toMatchObject({ phase: 'ready', controlled: false, truncated: true });
    // 没有控制时的按键不发送、不排队，而是当作「操作终端」自动去取得（2026-09-23）。
    f.attachment.input('ignored without control');
    expect(f.calls.map((c) => c.type)).toEqual(['attachTerminal', 'claimTerminalControl']);
    expect(await f.attachment.ensureControl()).toBe(true); f.attachment.input('one'); f.attachment.resize(120, 40);
    f.attachment.dispose();
    expect(f.calls.map((c) => c.type)).toEqual(['attachTerminal', 'claimTerminalControl', 'terminalInput', 'terminalResize', 'detachTerminal']);
    expect(f.calls.find((c) => c.type === 'terminalInput')).toMatchObject({ data: 'one' });
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

  test('操作终端自动取得：并发的点击、聚焦只发一次取得命令；被拒后一秒内不再每个按键都去撞', async () => {
    let time = 1_000_000;
    const f = fixture({ now: () => time }); await ready(f);
    const results = await Promise.all([f.attachment.ensureControl(), f.attachment.ensureControl(), f.attachment.ensureControl()]);
    expect(results).toEqual([true, true, true]); expect(claimTypes(f)).toBe(1);
    expect(f.attachment.getState()).toMatchObject({ controlled: true, refused: false });
    f.attachment.dispose();
    const g = fixture({ now: () => time }); await ready(g);
    g.control.result = async () => ({ controlled: false, expiresAt: null, control: { held: true, holder: li, revision: 4 } });
    expect(await g.attachment.ensureControl()).toBe(false);
    expect(g.attachment.getState()).toMatchObject({ controlled: false, refused: true, control: { holder: li } });
    time += 500; expect(await g.attachment.ensureControl()).toBe(false); expect(claimTypes(g)).toBe(1);
    time += 600; await g.attachment.ensureControl(); expect(claimTypes(g)).toBe(2);
    g.attachment.dispose();
  });

  test('只在终端活动时续约：离开后停止续约，让 Runner 的租约自然到期；回来再续', async () => {
    const f = fixture({ renewMs: 5 }); await ready(f);
    await f.attachment.claim();
    await Bun.sleep(30); expect(claimTypes(f)).toBe(1);
    f.attachment.setActive(true); await Bun.sleep(30);
    const whileActive = claimTypes(f); expect(whileActive).toBeGreaterThan(2);
    f.attachment.setActive(false); await Bun.sleep(5); const stopped = claimTypes(f); await Bun.sleep(30);
    expect(claimTypes(f)).toBe(stopped);
    f.attachment.setActive(true); await Bun.sleep(30); expect(claimTypes(f)).toBeGreaterThan(stopped);
    f.attachment.dispose();
  });

  test('Runner 推来的换人事件：序号更大就失去控制并停止续约；迟到的旧序号被丢弃；空闲时清掉被拒标记', async () => {
    const f = fixture({ renewMs: 5 }); await ready(f, { control: { held: false, revision: 3 } });
    f.control.result = async () => ({ controlled: true, expiresAt: null, control: { held: true, holder: zhang, revision: 4 } });
    f.attachment.setActive(true); await f.attachment.claim();
    f.pushControl({ held: true, holder: zhang, revision: 4 });
    expect(f.attachment.getState()).toMatchObject({ controlled: true, control: { revision: 4 } });
    f.pushControl({ held: true, holder: zhang, revision: 5 });
    expect(f.attachment.getState()).toMatchObject({ controlled: false, control: { held: true, holder: zhang, revision: 5 } });
    const after = claimTypes(f); await Bun.sleep(30); expect(claimTypes(f)).toBe(after);
    f.pushControl({ held: false, revision: 2 });
    expect(f.attachment.getState().control).toEqual({ held: true, holder: zhang, revision: 5 });
    f.control.result = async () => ({ controlled: false, expiresAt: null, control: { held: true, holder: li, revision: 6 } });
    await f.attachment.claim(); expect(f.attachment.getState().refused).toBe(true);
    f.pushControl({ held: false, revision: 7 });
    expect(f.attachment.getState()).toMatchObject({ refused: false, control: { held: false, revision: 7 } });
    f.attachment.dispose();
  });

  test('取得回执晚于同一用户另一窗口的接走事件：这次取得作废，不会以为自己还能输入', async () => {
    const f = fixture(); await ready(f);
    let reply: (value: TerminalControl) => void = () => {};
    f.control.result = () => new Promise((resolve) => { reply = resolve; });
    const pending = f.attachment.claim();
    f.pushControl({ held: true, holder: zhang, revision: 2 });
    reply({ controlled: true, expiresAt: null, control: { held: true, holder: zhang, revision: 1 } });
    expect(await pending).toBe(false);
    expect(f.attachment.getState()).toMatchObject({ controlled: false, control: { revision: 2 } });
    f.attachment.dispose();
  });

  test('附着途中推来的新状态不被快照里的旧状态盖掉', async () => {
    const f = fixture(); f.attachment.connect();
    f.pushControl({ held: true, holder: li, revision: 9 });
    f.snapshot(0, 'screen', { control: { held: false, revision: 8 } }); await f.attachment.refresh();
    expect(f.attachment.getState().control).toEqual({ held: true, holder: li, revision: 9 });
    f.attachment.dispose();
  });

  // 旧 Runner 不推送：离开终端后租约悄悄到期，用户回来直接打字，拒绝经 cs-session 只剩 precondition。不能报错，要当作「操作终端」重新取得。
  test('输入因租约已过被拒：不显示错误，立即重新取得；其他错误照常显示', async () => {
    const f = fixture(); await ready(f);
    await f.attachment.claim();
    f.control.input = async () => { throw new StreamCommandError('precondition', '当前视图未取得此终端的输入控制'); };
    f.attachment.input('x'); await Bun.sleep(0); await Bun.sleep(0);
    expect(f.attachment.getState()).toMatchObject({ controlled: true, error: undefined });
    expect(claimTypes(f)).toBe(2);
    f.control.input = async () => { throw new StreamCommandError('validation', '命令帧不合法'); };
    f.attachment.input('y'); await Bun.sleep(0);
    expect(f.attachment.getState()).toMatchObject({ controlled: false, error: '命令帧不合法' });
    f.attachment.dispose();
  });

  test('旧 Runner：回执与快照都没有控制状态，被拒时只能标记被占用', async () => {
    const f = fixture(); await ready(f);
    f.control.result = async () => ({ controlled: false, expiresAt: '2026-09-13T00:00:30.000Z' });
    await f.attachment.claim();
    expect(f.attachment.getState()).toMatchObject({ controlled: false, refused: true });
    expect(f.attachment.getState().control).toBeUndefined();
    f.attachment.dispose();
  });
});
