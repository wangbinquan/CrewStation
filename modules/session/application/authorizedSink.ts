import type { EventSink } from '../domain/runnerConnection';

/** Each bounded frame batch observes current access. No authorization is cached between batches. */
export function authorizedSink(sink: EventSink, allowed: () => Promise<boolean>, revoked: () => void) {
  let pending: string[] = [], bytes = 0, stopped = false;
  let chain: Promise<void> = Promise.resolve();
  let failure: unknown;
  const stop = () => {
    if (stopped) return;
    stopped = true; pending = []; bytes = 0;
    try { sink.send(JSON.stringify({ type: 'error', id: 'access', code: 'forbidden', message: '项目权限已变化，请返回应用首页' })); }
    catch { /* A broken socket still needs its subscription removed. */ }
    finally { revoked(); sink.close?.(1008, 'permission revoked'); }
  };
  const flush = async () => {
    if (stopped || !pending.length) return;
    const batch = pending; pending = []; bytes = 0;
    let permitted = false;
    try { permitted = await allowed(); } catch { /* Fail closed when identity cannot be checked. */ }
    if (!permitted) { stop(); return; }
    if (!stopped) for (const frame of batch) sink.send(frame);
  };
  return {
    send(frame: string) {
      if (stopped) return;
      bytes += Buffer.byteLength(frame);
      if (pending.length >= 6000 || bytes > 8 * 1024 * 1024) { stop(); return; }
      pending.push(frame);
      if (pending.length === 1) chain = chain.then(flush).catch((error: unknown) => {
        failure = error; stopped = true; pending = []; bytes = 0;
        revoked(); sink.close?.(1013, 'stream unavailable');
      });
    },
    drain: async () => { await chain; if (failure) throw failure; },
    check: async () => {
      if (stopped) return false;
      try { if (await allowed()) return true; } catch { /* handled below */ }
      stop(); return false;
    },
    close: () => { stopped = true; pending = []; bytes = 0; },
  };
}
