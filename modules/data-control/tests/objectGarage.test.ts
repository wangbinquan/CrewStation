import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { s3ObjectPlane } from '../adapters/http/s3Objects';
import { probeObjectBucket } from '../adapters/http/objectProbe';
import { observeGarage } from '../adapters/http/garageObservation';
import { garageAvailable, startGarage } from './garageFixture';

let garage: Awaited<ReturnType<typeof startGarage>>;
beforeAll(async () => { if (garageAvailable) garage = await startGarage(); }, 90_000);
afterAll(async () => { await garage?.dispose(); }, 30_000);
const location = () => ({ backendId: Bun.randomUUIDv7(), placementRevision: 1, key: `spaces/${Bun.randomUUIDv7()}/attempts/${Bun.randomUUIDv7()}` });
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const deadline = () => AbortSignal.timeout(60_000);

describe.skipIf(!garageAvailable)('Garage v2.4.1 real object protocol', () => {
  test('physical capacity is observed with a token that cannot access keys or change buckets', async () => {
    const until = Date.now() + 15_000;
    let observation = await observeGarage(garage.config.monitoring!, deadline());
    while (observation.freeBytes === null && Date.now() < until) { await Bun.sleep(500); observation = await observeGarage(garage.config.monitoring!, deadline()); }
    expect(observation.health).toBe('ready'); expect(observation.freeBytes).toBeGreaterThan(0); expect(observation.totalBytes).toBeGreaterThanOrEqual(observation.freeBytes!);
    const privateEndpoint = await fetch(`${garage.config.monitoring!.endpoint}/v2/ListKeys`, { headers: { authorization: `Bearer ${garage.config.monitoring!.token}` }, signal: deadline() });
    expect(privateEndpoint.status).toBe(403); await privateEndpoint.body?.cancel();
  }, 30_000);
  test('signed streaming PUT, read-back, Range, empty object and confirmed delete', async () => {
    const plane = s3ObjectPlane({ endpoint: async () => garage.config });
    for (const bytes of [new Uint8Array(0), new TextEncoder().encode('归档产物\n'), new Uint8Array(2 * 1024 ** 2).fill(57)]) {
      const object = location(), sha256 = digest(bytes);
      expect(await plane.put(object, { body: new Blob([bytes]).stream(), size: bytes.length, sha256, signal: deadline() })).toEqual({ size: bytes.length, sha256 });
      expect(await plane.verify(object, deadline())).toEqual({ size: bytes.length, sha256 });
      if (bytes.length > 3) { const partial = await plane.get(object, { signal: deadline(), range: 'bytes=1-3' }); expect(partial.contentRange).toBe(`bytes 1-3/${bytes.length}`); expect(new Uint8Array(await new Response(partial.body).arrayBuffer())).toEqual(bytes.slice(1, 4)); }
      await plane.remove(object, deadline());
      await expect(plane.get(object, { signal: deadline() })).rejects.toThrow('不存在');
    }
  }, 60_000);
  test('credential rejection never leaks secrets; stored bytes survive Garage process restart', async () => {
    const plane = s3ObjectPlane({ endpoint: async () => garage.config }), object = location(), bytes = new TextEncoder().encode('durable artifact'), sha256 = digest(bytes);
    await plane.put(object, { body: new Blob([bytes]).stream(), size: bytes.length, sha256, signal: deadline() });
    const denied = s3ObjectPlane({ endpoint: async () => ({ ...garage.config, secretAccessKey: 'incorrect' }) });
    await expect(denied.verify(object, deadline())).rejects.toThrow('请求失败');
    await garage.restart();
    const until = Date.now() + 30_000;
    while (true) { try { await probeObjectBucket(garage.config, AbortSignal.timeout(2000)); break; } catch { if (Date.now() > until) throw new Error('Garage restart failed'); await Bun.sleep(250); } }
    expect(await plane.verify(object, deadline())).toEqual({ size: bytes.length, sha256 });
    await plane.remove(object, deadline());
  }, 60_000);
});
