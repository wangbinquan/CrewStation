import { afterEach, describe, expect, test } from 'bun:test';
import type { CloseInfo } from './reconnectingClient';
import { ReconnectingWebSocketClient } from './reconnectingClient';

interface EchoServer { port: number; received: string[]; opened: number; stop(): void }

function startEchoServer(port = 0): EchoServer {
  const state: EchoServer = { port: 0, received: [], opened: 0, stop: () => undefined };
  const server = Bun.serve({
    port,
    routes: { '/ws': (req, srv) => (srv.upgrade(req) ? undefined : new Response('expected websocket', { status: 426 })) },
    websocket: {
      open() {
        state.opened += 1;
      },
      message(ws, message) {
        const text = typeof message === 'string' ? message : new TextDecoder().decode(message);
        state.received.push(text);
        ws.send(`echo:${text}`);
      },
    },
  });
  state.port = server.port ?? 0;
  state.stop = () => server.stop(true);
  return state;
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor 超时');
    await Bun.sleep(10);
  }
}

const clients: ReconnectingWebSocketClient[] = [];
const servers: EchoServer[] = [];
afterEach(() => {
  for (const client of clients.splice(0)) client.close();
  for (const server of servers.splice(0)) server.stop();
});

describe('ReconnectingWebSocketClient', () => {
  test('共享二进制缓冲与子视图按发送时的字节快照写入，不扩大为整个 backing buffer', async () => {
    const server = startEchoServer();
    servers.push(server);
    const client = new ReconnectingWebSocketClient({ url: `ws://127.0.0.1:${server.port}/ws` });
    clients.push(client);
    client.connect();
    await waitFor(() => client.state === 'open');
    const buffer = new SharedArrayBuffer(4);
    const bytes = new Uint8Array(buffer);
    bytes.set([65, 66, 67, 68]);
    client.send(buffer);
    client.send(bytes.subarray(1, 3));
    bytes.fill(88);
    await waitFor(() => server.received.length === 2);
    expect(server.received).toEqual(['ABCD', 'BC']);
  });
  test('连接、收发、断线后按退避重连到同一端口、close 后不再重连', async () => {
    const first = startEchoServer();
    servers.push(first);
    const messages: string[] = [];
    const closes: CloseInfo[] = [];
    let opens = 0;
    const client = new ReconnectingWebSocketClient({
      url: `ws://127.0.0.1:${first.port}/ws`,
      backoff: { baseMs: 20, maxMs: 60, jitter: 0 },
      onOpen: () => { opens += 1; },
      onMessage: (data) => { messages.push(typeof data === 'string' ? data : new TextDecoder().decode(data)); },
      onClose: (info) => { closes.push(info); },
    });
    clients.push(client);
    expect(client.state).toBe('idle');
    expect(() => client.send('early')).toThrow(/未连接/);
    client.connect();
    await waitFor(() => client.state === 'open');
    client.send('hello');
    await waitFor(() => messages.length === 1);
    expect(messages[0]).toBe('echo:hello');

    first.stop();
    await waitFor(() => closes.length === 1);
    expect(closes[0]?.willReconnect).toBe(true);
    await waitFor(() => client.state === 'waiting' || client.state === 'connecting');
    expect(() => client.send('while down')).toThrow(/未连接/);
    await Bun.sleep(150);
    expect(client.attempts).toBeGreaterThanOrEqual(1);

    const second = startEchoServer(first.port);
    servers.push(second);
    await waitFor(() => client.state === 'open' && opens === 2);
    expect(client.attempts).toBe(0);
    client.send('again');
    await waitFor(() => messages.length === 2);
    expect(second.received).toEqual(['again']);

    client.close();
    expect(client.state).toBe('closed');
    await Bun.sleep(100);
    expect(closes.at(-1)?.willReconnect).toBe(false);
    expect(opens).toBe(2);
  });

  test('reconnectNow 丢弃当前连接并重连；maxAttempts 耗尽后进入 closed', async () => {
    const server = startEchoServer();
    servers.push(server);
    let opens = 0;
    const client = new ReconnectingWebSocketClient({ url: `ws://127.0.0.1:${server.port}/ws`, backoff: { baseMs: 10, maxMs: 20, jitter: 0 }, onOpen: () => { opens += 1; } });
    clients.push(client);
    client.connect();
    await waitFor(() => opens === 1);
    client.reconnectNow('watchdog');
    await waitFor(() => opens === 2);
    expect(server.opened).toBe(2);

    const doomed = new ReconnectingWebSocketClient({ url: 'ws://127.0.0.1:1/ws', backoff: { baseMs: 5, maxMs: 10, jitter: 0 }, maxAttempts: 3 });
    clients.push(doomed);
    doomed.connect();
    await waitFor(() => doomed.state === 'closed', 5000);
    expect(doomed.attempts).toBe(3);
  });
});
