import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { TaskId, UserId } from '@crewstation/contracts';
import { IDENTITY_HEADERS, TASKRUNNER_PROTOCOL_VERSION } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { SessionModule } from '../wiring';
import { createSessionModule, sessionMigrations } from '../wiring';

const available = await testDatabaseAvailable();
let tdb: TestDatabase;
let session: SessionModule;
let server: ReturnType<typeof Bun.serve>;
let base = '';
const taskId = 'tsk_0123456789abcdef0123456789abcdef' as TaskId;
const connectedEvents: string[] = [];

const openSocket = (url: string, headers: Record<string, string> = {}): Promise<{ ws: WebSocket; frames: unknown[]; next: (pred?: (f: unknown) => boolean) => Promise<unknown> }> => new Promise((resolve, reject) => {
  const ws = new WebSocket(url, { headers } as never);
  const frames: unknown[] = [];
  const waiters: Array<{ pred: (f: unknown) => boolean; resolve: (f: unknown) => void }> = [];
  ws.onmessage = (m) => { const f = JSON.parse(String(m.data)); frames.push(f); const i = waiters.findIndex((w) => w.pred(f)); if (i >= 0) waiters.splice(i, 1)[0]!.resolve(f); };
  ws.onopen = () => resolve({ ws, frames, next: (pred = () => true) => new Promise((res) => { const hit = frames.find(pred); if (hit) { res(hit); return; } waiters.push({ pred, resolve: res }); }) });
  ws.onerror = (e) => reject(e);
});

beforeAll(async () => {
  if (!available) return;
  tdb = await createTestDatabase([sessionMigrations]);
  session = createSessionModule({
    db: tdb.db,
    runnerAuth: { verifyRunnerToken: async (_t, token) => (token === 'good' ? { ok: true, projectId: 'prj' } : { ok: false, reason: '令牌无效' }) },
    taskAccess: { canOpenStream: async (actor) => actor.userId !== ('usr_ffffffffffffffffffffffffffffffff' as UserId), onRunnerConnected: async () => { connectedEvents.push('up'); }, onRunnerDisconnected: async () => { connectedEvents.push('down'); } },
    isAdmin: async () => false,
    settings: { selfAddress: 'http://127.0.0.1:0', commandTimeoutMs: 2000, runnerStaleMs: 30000, replayLimit: 100 },
  });
  const app = createApp({ name: 'cs-session-test' });
  app.route('/', session.http.runner); app.route('/', session.http.stream); app.route('/', session.http.internal);
  server = Bun.serve({ port: 0, fetch: app.fetch, websocket: session.websocket });
  base = `127.0.0.1:${server.port}`;
});
afterAll(async () => { server?.stop(true); await tdb?.drop(); });

describe.skipIf(!available)('session module', () => {
  test('hello 令牌错误被拒；正确则 welcome 并回调 task-runtime', async () => {
    const bad = await openSocket(`ws://${base}/runner`);
    bad.ws.send(JSON.stringify({ type: 'hello', protocolVersion: TASKRUNNER_PROTOCOL_VERSION, taskId, runnerToken: 'bad', workdir: '/work', capabilities: { drivers: ['stub'], pty: false, preview: false } }));
    expect(await bad.next((f) => (f as { type: string }).type === 'error')).toMatchObject({ code: 'unauthorized' });
    const good = await openSocket(`ws://${base}/runner`);
    good.ws.send(JSON.stringify({ type: 'hello', protocolVersion: TASKRUNNER_PROTOCOL_VERSION, taskId, runnerToken: 'good', workdir: '/work', capabilities: { drivers: ['stub'], pty: false, preview: true } }));
    expect(await good.next((f) => (f as { type: string }).type === 'welcome')).toMatchObject({ resumeFromSeq: 0 });
    expect(connectedEvents).toEqual(['up']);
    expect(await session.api.connectionStatus(taskId)).toMatchObject({ connected: true, drivers: ['stub'] });

    good.ws.send(JSON.stringify({ type: 'event', seq: 1, at: new Date().toISOString(), event: { kind: 'agent', event: { agentId: 'a1', seq: 0, at: new Date().toISOString(), type: 'text', text: 'hello' } } }));
    good.ws.send(JSON.stringify({ type: 'event', seq: 2, at: new Date().toISOString(), event: { kind: 'terminalOutput', terminalId: 't1', data: 'ephemeral' } }));
    good.ws.send(JSON.stringify({ type: 'event', seq: 1, at: new Date().toISOString(), event: { kind: 'agent', event: { agentId: 'a1', seq: 0, at: new Date().toISOString(), type: 'text', text: 'duplicate' } } }));
    await Bun.sleep(150);
    const stored = await session.api.listEvents(taskId, {});
    expect(stored.map((e) => [e.seq, e.event.kind])).toEqual([[1, 'agent']]);

    const browser = await openSocket(`ws://${base}/v1/tasks/${taskId}/stream?sinceSeq=0`, { [IDENTITY_HEADERS.userId]: 'usr_0123456789abcdef0123456789abcdef' });
    const ready = await browser.next((f) => (f as { type: string }).type === 'streamReady');
    expect(ready).toMatchObject({ connected: true, replayed: 1 });
    expect(browser.frames[0]).toMatchObject({ type: 'event', seq: 1 });

    browser.ws.send(JSON.stringify({ id: 'c1', type: 'previewStatus' }));
    const cmd = await good.next((f) => (f as { type: string }).type === 'previewStatus') as { id: string };
    good.ws.send(JSON.stringify({ type: 'result', id: cmd.id, payload: { state: 'ready', port: 3000, restarts: 0 } }));
    expect(await browser.next((f) => (f as { type: string }).type === 'result')).toMatchObject({ id: 'c1', payload: { state: 'ready' } });

    const internal = fetch(`http://${base}/internal/tasks/${taskId}/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'c2', type: 'listFiles', path: '.' }) });
    const cmd2 = await good.next((f) => (f as { type: string; id?: string }).id === 'c2') as { id: string };
    good.ws.send(JSON.stringify({ type: 'result', id: cmd2.id, payload: { path: '.', entries: [] } }));
    expect(await (await internal).json()).toEqual({ payload: { path: '.', entries: [] } });

    good.ws.send(JSON.stringify({ type: 'event', seq: 3, at: new Date().toISOString(), event: { kind: 'previewState', state: 'ready', port: 3000 } }));
    expect(await browser.next((f) => (f as { seq?: number }).seq === 3)).toMatchObject({ type: 'event' });

    const stranger = await openSocket(`ws://${base}/v1/tasks/${taskId}/stream`, { [IDENTITY_HEADERS.userId]: 'usr_ffffffffffffffffffffffffffffffff' });
    expect(await stranger.next((f) => (f as { type: string }).type === 'error')).toMatchObject({ code: 'forbidden' });

    good.ws.close();
    await Bun.sleep(150);
    expect(connectedEvents).toEqual(['up', 'down']);
    expect(await browser.next((f) => (f as { type: string }).type === 'runnerDisconnected')).toBeDefined();
    await expect(session.api.sendCommand(taskId, { id: 'c3', type: 'previewStatus' })).rejects.toMatchObject({ kind: 'unavailable' });
    browser.ws.close(); stranger.ws.close(); bad.ws.close();
  });

  test('hello 之后紧跟的事件帧不会被当成第二个 hello', async () => {
    const burstTask = 'tsk_00000000000000000000000000000002' as TaskId;
    const runner = await openSocket(`ws://${base}/runner`);
    // hello 与随后的事件帧在同一个 tick 里发出：hello 的校验与建连是异步的，
    // 早期实现会在它落地前把第 2 帧再次当成 hello，以 1008「首帧必须是 hello」断开。
    const at = new Date().toISOString();
    runner.ws.send(JSON.stringify({ type: 'hello', protocolVersion: TASKRUNNER_PROTOCOL_VERSION, taskId: burstTask, runnerToken: 'good', workdir: '/work', capabilities: { drivers: ['stub'], pty: false, preview: false } }));
    for (let seq = 1; seq <= 5; seq += 1) {
      runner.ws.send(JSON.stringify({ type: 'event', seq, at, event: { kind: 'agent', event: { agentId: 'a1', seq, at, type: 'text', text: `burst ${seq}` } } }));
    }
    expect(await runner.next((f) => (f as { type: string }).type === 'welcome')).toMatchObject({ resumeFromSeq: 0 });
    await Bun.sleep(200);
    expect(runner.frames.some((f) => (f as { type: string }).type === 'error')).toBe(false);
    expect(runner.ws.readyState).toBe(WebSocket.OPEN);
    expect((await session.api.listEvents(burstTask, {})).map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
    runner.ws.close();
    // 断开回调要写注册表，等它落地再让 afterAll 丢库。
    await Bun.sleep(150);
  });
});
