import { expect, test } from 'bun:test';
import { readProbeResponse } from './probeRead';

const endpoint = new URL('http://probe.test/registry/inventory');
test('unrecognized conflicts never repeat a read or become empty successful inventory', async () => {
  for (const body of ['{', 'null', '[]', '{}', '{"error":"different conflict"}', '{"error":"A measurement is already running","changed":true}']) {
    let calls = 0;
    const result = await readProbeResponse(async () => { calls++; return new Response(body, { status: 409 }); }, endpoint, { method: 'POST' }, AbortSignal.timeout(1000));
    expect(result.status).toBe(409); expect(await result.text()).toBe(body); expect(calls).toBe(1);
  }
  await expect(readProbeResponse(async () => new Response('x'.repeat(4097), { status: 409 }), endpoint, {}, AbortSignal.timeout(1000))).rejects.toThrow('budget');
});

test('persistent contention, stalled conflict body and late transport success cannot escape the original cancellation', async () => {
  let calls = 0;
  await expect(readProbeResponse(async () => { calls++; return Response.json({ error: 'A measurement is already running' }, { status: 409 }); }, endpoint, {}, AbortSignal.timeout(10))).rejects.toThrow();
  expect(calls).toBe(1);
  let cancelled = false;
  await expect(readProbeResponse(async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 409 }), endpoint, {}, AbortSignal.timeout(10))).rejects.toThrow();
  expect(cancelled).toBe(true);
  const controller = new AbortController(); let lateCancelled = false;
  await expect(readProbeResponse(async () => {
    controller.abort(new Error('original read cancelled'));
    return new Response(new ReadableStream({ cancel() { lateCancelled = true; } }));
  }, endpoint, {}, controller.signal)).rejects.toThrow('original read cancelled');
  expect(lateCancelled).toBe(true);
});
