import { afterEach, expect, test } from 'bun:test';
import { TaskStreamSocket } from '../features/dev-session/model/taskStreamSocket';

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 1;
  sent: Array<{ id: string; type: string }> = [];
  onopen?: () => void;
  onclose?: () => void;
  onerror?: () => void;
  onmessage?: (event: { data: string }) => void;
  constructor(readonly url: string) { Socket.instances.push(this); }
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; this.onclose?.(); }
  receive(frame: object) { this.onmessage?.({ data: JSON.stringify(frame) }); }
}
const original = globalThis.WebSocket;
let active: TaskStreamSocket | undefined;
afterEach(() => { active?.stop(); active = undefined; globalThis.WebSocket = original; Socket.instances = []; });
function start(commandTimeoutMs?: number) {
  globalThis.WebSocket = Socket as unknown as typeof WebSocket;
  const stream = new TaskStreamSocket((seq) => `ws://test/stream?sinceSeq=${seq}`, commandTimeoutMs);
  active = stream; stream.start();
  return { stream, socket: Socket.instances[0]! };
}
const event = (seq: number) => ({ type: 'event', seq, at: '2026-09-13T00:00:00.000Z', event: { kind: 'runnerState', state: 'ready' } });

test('命令等待完整回放就绪，分页续接保持未发送命令且不用跳过的实时 seq', async () => {
  const { stream, socket } = start();
  const command = stream.send({ type: 'listFiles', path: '.' });
  socket.onopen?.();
  expect(socket.sent).toHaveLength(0);
  socket.receive(event(1)); socket.receive(event(2));
  socket.receive({ type: 'streamReady', connected: false, replayed: 2, replayComplete: false, resumeFromSeq: 2 });
  expect(stream.getState().runnerConnected).toBe(false);
  await Bun.sleep(30);
  const next = Socket.instances[1]!;
  expect(next.url).toBe('ws://test/stream?sinceSeq=2');
  next.onopen?.(); expect(next.sent).toHaveLength(0);
  next.receive(event(3));
  next.receive({ type: 'streamReady', connected: true, replayed: 1, replayComplete: true });
  expect(next.sent).toHaveLength(1);
  expect(stream.getState()).toMatchObject({ status: 'open', lastSeq: 3, generation: 1 });
  next.receive({ type: 'result', id: next.sent[0]!.id, payload: { entries: [] } });
  expect(await command).toEqual({ entries: [] });
});

test('旧 socket 的延迟消息和错误不影响新连接，同一 seq 只交给订阅者一次', async () => {
  const { stream, socket } = start();
  const seqs: number[] = []; stream.subscribeEvents((_event, seq) => seqs.push(seq));
  socket.receive(event(1)); socket.receive(event(1));
  socket.receive({ type: 'streamReady', connected: false, replayed: 1, replayComplete: false, resumeFromSeq: 1 });
  await Bun.sleep(30);
  const next = Socket.instances[1]!;
  next.receive(event(2)); next.receive({ type: 'streamReady', connected: true, replayed: 1 });
  socket.receive(event(50)); socket.onerror?.();
  expect(seqs).toEqual([1, 2]);
  expect(stream.getState()).toMatchObject({ lastSeq: 2, status: 'open', runnerConnected: true, error: undefined });
});


test('历史补齐前已超时的命令不再发往 Runner', async () => {
  const { stream, socket } = start(1);
  const command = stream.send({ type: 'writeFile', path: 'draft.ts', content: 'late write' });
  await expect(command).rejects.toMatchObject({ code: 'timeout' });
  socket.receive({ type: 'streamReady', connected: true, replayed: 0, replayComplete: true });
  expect(socket.sent).toHaveLength(0);
});
