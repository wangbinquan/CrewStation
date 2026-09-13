import type { RunnerEvent, RunnerHello, RunnerMessage } from '@crewstation/contracts';
import { RunnerMessageSchema, TASKRUNNER_PROTOCOL_VERSION } from '@crewstation/contracts';

export interface EventFrame<E extends RunnerEvent = RunnerEvent> {
  seq: number;
  at: string;
  event: E;
}

export type EventOfKind<K extends RunnerEvent['kind']> = Extract<RunnerEvent, { kind: K }>;

export interface FakeSessionOptions {
  /** 0 表示随机端口；重连测试用同一端口再起一个。 */
  port?: number;
  /** 每次收到 hello 时决定 welcome 的 resumeFromSeq。 */
  resumeFromSeq?: () => number;
  nativeActivity?: boolean;
}

export class CommandFailure extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'CommandFailure';
  }
}

/** 假的 cs-session：接受 hello、回 welcome、记录并严格校验 runner 发来的每一帧。 */
export interface FakeSession {
  readonly url: string;
  readonly port: number;
  readonly frames: RunnerMessage[];
  readonly hellos: RunnerHello[];
  readonly connections: number;
  events(): EventFrame[];
  eventsOf<K extends RunnerEvent['kind']>(kind: K): EventFrame<EventOfKind<K>>[];
  waitFor<T>(pick: () => T | undefined, timeoutMs?: number, label?: string): Promise<T>;
  waitForEvent<K extends RunnerEvent['kind']>(kind: K, predicate?: (event: EventOfKind<K>) => boolean, timeoutMs?: number): Promise<EventFrame<EventOfKind<K>>>;
  send(frame: object): void;
  /** 发命令并等待同 id 的 result／error；error 抛 CommandFailure。返回 unknown，调用方用 RunnerResultPayloads 解析。 */
  call(command: { id: string; type: string } & Record<string, unknown>, timeoutMs?: number): Promise<unknown>;
  /** 强制关闭所有连接并停止监听。 */
  stop(): void;
}

export function startFakeSession(options: FakeSessionOptions = {}): FakeSession {
  const frames: RunnerMessage[] = [];
  const hellos: RunnerHello[] = [];
  let current: { send(data: string): void } | undefined;
  let connections = 0;
  const server = Bun.serve({
    port: options.port ?? 0,
    routes: {
      '/runner': (req, srv) => (srv.upgrade(req) ? undefined : new Response('expected websocket', { status: 426 })),
    },
    websocket: {
      open(ws) {
        connections += 1;
        current = ws;
      },
      message(ws, raw) {
        const frame = RunnerMessageSchema.parse(JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)));
        frames.push(frame);
        if (frame.type === 'hello') {
          hellos.push(frame);
          ws.send(JSON.stringify({ type: 'welcome', protocolVersion: TASKRUNNER_PROTOCOL_VERSION, resumeFromSeq: options.resumeFromSeq?.() ?? 0, ...(options.nativeActivity === false ? {} : { nativeActivityVersion: 1 }) }));
        }
      },
      close(ws) {
        if (current === ws) current = undefined;
      },
    },
  });
  const port = server.port ?? 0;
  const events = (): EventFrame[] => frames.flatMap((f) => (f.type === 'event' ? [{ seq: f.seq, at: f.at, event: f.event }] : []));
  const waitFor = async <T>(pick: () => T | undefined, timeoutMs = 5000, label = 'condition'): Promise<T> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = pick();
      if (value !== undefined) return value;
      if (Date.now() > deadline) throw new Error(`waitFor 超时：${label}`);
      await Bun.sleep(5);
    }
  };
  const session: FakeSession = {
    url: `ws://127.0.0.1:${port}/runner`,
    port,
    frames,
    hellos,
    get connections() {
      return connections;
    },
    events,
    eventsOf: <K extends RunnerEvent['kind']>(kind: K) => events().filter((e): e is EventFrame<EventOfKind<K>> => e.event.kind === kind),
    waitFor,
    waitForEvent: (kind, predicate = () => true, timeoutMs = 5000) =>
      waitFor(() => session.eventsOf(kind).find((e) => predicate(e.event)), timeoutMs, `event ${kind}`),
    send(frame) {
      if (!current) throw new Error('没有活动的 runner 连接');
      current.send(JSON.stringify(frame));
    },
    async call(command, timeoutMs = 5000) {
      session.send(command);
      const reply = await waitFor(() => frames.find((f) => (f.type === 'result' || f.type === 'error') && f.id === command.id), timeoutMs, `reply ${command.id}`);
      if (reply.type === 'error') throw new CommandFailure(reply.code, reply.message);
      return (reply as { payload: unknown }).payload;
    },
    stop() {
      server.stop(true);
    },
  };
  return session;
}
