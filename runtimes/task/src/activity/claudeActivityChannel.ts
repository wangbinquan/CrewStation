import { ClaudeNativeActivity, parseClaudeNativeHook, parseClaudeNativeTelemetry } from '@crewstation/agent-drivers';
import type { NativeActivityObserver } from './nativeActivityChannel';
import { createActivityStamp, type NativeActivityOptions } from './nativeActivityStamp';
import { ClaudeTranscriptReader } from './claudeTranscriptReader';

/** 私有环回接收器；hook 保持原生交互，OTel metrics 证明状态通道活性，不以终端静默推断。 */
export function createClaudeActivityChannel(options: NativeActivityOptions): NativeActivityObserver {
  const token = crypto.randomUUID();
  const prefix = `/activity/${token}`;
  const stamp = createActivityStamp(options);
  const normalizer = new ClaudeNativeActivity(stamp);
  const reader = new ClaudeTranscriptReader((node) => normalizer.transcript(node), () => normalizer.gap('source-error'));
  const state = { closed: false, heartbeat: Date.now(), pending: 0, serial: Promise.resolve() };
  const receive = async (path: string, body: unknown) => {
    if (state.closed) return;
    if (path === '/hooks') {
      const hook = parseClaudeNativeHook(body);
      normalizer.hook(hook);
      if (!hook.child && hook.transcriptPath) reader.track(hook.sessionId, hook.transcriptPath);
      await reader.read();
      return;
    }
    const kind = path.slice(4) as 'logs' | 'traces' | 'metrics';
    const events = parseClaudeNativeTelemetry(kind, body);
    await reader.read();
    if (state.closed) return;
    for (const event of events) {
      if (event.type === 'heartbeat') state.heartbeat = Date.now();
      normalizer.telemetry(event);
    }
  };
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, maxRequestBodySize: 2 * 1024 * 1024, async fetch(request) {
    const path = new URL(request.url).pathname;
    if (state.closed || request.method !== 'POST' || !path.startsWith(`${prefix}/`)) return new Response(null, { status: 404 });
    const suffix = path.slice(prefix.length);
    if (!['/hooks', '/v1/logs', '/v1/traces', '/v1/metrics'].includes(suffix)) return new Response(null, { status: 404 });
    if (state.pending >= 16) { normalizer.gap('capacity'); return new Response(null, { status: 503 }); }
    state.pending++;
    try {
      const body: unknown = await request.json();
      const processing = state.serial.then(() => receive(suffix, body));
      state.serial = processing.catch(() => { normalizer.gap('source-error'); });
      await processing;
      return Response.json({});
    } catch { normalizer.gap('source-error'); return new Response(null, { status: 400 }); }
    finally { state.pending--; }
  } });
  const leaseMs = options.leaseMs ?? 20000;
  const timer = setInterval(() => {
    if (Date.now() - state.heartbeat > leaseMs) normalizer.gap('source-error');
    normalizer.check(Date.now());
    void reader.read();
  }, Math.min(1000, leaseMs));
  timer.unref();
  return {
    options: { endpoint: `http://127.0.0.1:${server.port}${prefix}`, token },
    unavailable: (reason) => normalizer.gap(reason),
    close() {
      if (state.closed) return;
      state.closed = true; clearInterval(timer); reader.close(); server.stop(true);
      stamp({ source: 'claude-code/2.1.268', sourceEventId: 'process-ended', kind: 'process-ended', occurredAt: new Date().toISOString(), nativeSessionId: null, turnId: null });
    },
  };
}
