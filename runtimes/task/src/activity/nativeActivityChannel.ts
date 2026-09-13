import type { NativeActivityChannel } from '@crewstation/agent-drivers';
import { OpencodeNativeActivity } from '@crewstation/agent-drivers';
import type { NativeActivityEvent, NativeActivitySignal } from '@crewstation/contracts';
import { NativeObservationEnvelopeSchema } from '@crewstation/contracts';

export interface NativeActivityObserver {
  options: NativeActivityChannel;
  unavailable(reason: 'unsupported-version' | 'source-error'): void;
  close(): void;
}

interface Options {
  agentId: string;
  terminalId: string;
  runnerId: string;
  emit(activity: NativeActivityEvent): void;
  /** 探针可指向固定验收镜像；生产缺省由任务镜像预装。 */
  dependencyDir?: string;
  leaseMs?: number;
}

/** 只监听容器环回，每个 CLI 独立令牌和单调源序号。通道失联只降级，不猜测轮次成功。 */
export function createOpencodeActivityChannel(options: Options): NativeActivityObserver {
  const token = crypto.randomUUID();
  const stamp = createActivityStamp(options);
  const normalizer = new OpencodeNativeActivity(stamp);
  const state = { closed: false, sequence: 0, ready: false, degraded: false, lastContact: Date.now() };
  const now = () => new Date().toISOString();
  const gap = (reason: NativeActivitySignal['reason']) => { state.degraded = true; normalizer.gap(now(), crypto.randomUUID(), reason); };
  const leaseMs = options.leaseMs ?? 20000;
  const server = Bun.serve({
    hostname: '127.0.0.1', port: 0, maxRequestBodySize: 32768,
    async fetch(request) {
      if (state.closed || request.method !== 'POST' || new URL(request.url).pathname !== '/activity') return new Response(null, { status: 404 });
      if (request.headers.get('authorization') !== `Bearer ${token}`) return new Response(null, { status: 403 });
      let input: unknown;
      try { input = await request.json(); } catch { gap('source-error'); return new Response(null, { status: 400 }); }
      const parsed = NativeObservationEnvelopeSchema.safeParse(input);
      if (!parsed.success) { gap('source-error'); return new Response(null, { status: 400 }); }
      const { sequence, event } = parsed.data;
      if (sequence <= state.sequence) return Response.json({});
      if (sequence !== state.sequence + 1) gap('channel-gap');
      state.sequence = sequence;
      state.lastContact = Date.now();
      if (event.type === 'ready') {
        if (sequence !== 1) gap('channel-gap');
        if (!state.ready && sequence === 1 && !state.degraded) stamp({ source: 'opencode/1.18.29', sourceEventId: 'observer-ready', kind: 'source-ready', occurredAt: now(), nativeSessionId: null, turnId: null });
        state.ready = true;
      } else if (event.type === 'gap') gap('channel-gap');
      else if (event.type !== 'heartbeat') {
        if (!state.ready) gap('channel-gap');
        normalizer.accept(event);
      }
      return Response.json({});
    },
  });
  const timer = setInterval(() => {
    if (Date.now() - state.lastContact >= leaseMs) gap('source-error');
  }, Math.min(5000, leaseMs));
  timer.unref();
  return {
    options: { endpoint: `http://127.0.0.1:${server.port}/activity`, token, opencodeDependencies: options.dependencyDir ?? '/opt/crewstation-opencode-plugin' },
    unavailable: gap,
    close() {
      if (state.closed) return;
      state.closed = true;
      clearInterval(timer);
      server.stop(true);
      stamp({ source: 'opencode/1.18.29', sourceEventId: 'process-ended', kind: 'process-ended', occurredAt: now(), nativeSessionId: null, turnId: null });
    },
  };
}

function createActivityStamp(options: Options): (signal: NativeActivitySignal) => void {
  let sequence = 0, ordinal = 0;
  const turns = new Map<string, number>();
  return (signal) => {
    if (signal.kind === 'turn-started' && signal.turnId && !turns.has(signal.turnId)) {
      turns.set(signal.turnId, ++ordinal);
      if (turns.size > 256) turns.delete(turns.keys().next().value!);
    }
    const seq = ++sequence;
    options.emit({ agentId: options.agentId, terminalId: options.terminalId, runnerId: options.runnerId, eventId: crypto.randomUUID(), seq, turnOrdinal: signal.turnId ? turns.get(signal.turnId) ?? 0 : 0, signal });
  };
}
