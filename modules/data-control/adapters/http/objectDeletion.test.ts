import { expect, test } from 'bun:test';
import { objectDeletionTransport } from './objectDeletion';

const original = { endpoint: 'https://original.invalid', bucket: 'original-bucket', region: 'garage', accessKeyId: 'original-access', secretAccessKey: 'confidential-secret' };
const location = { backendId: 'original-backend', placementRevision: 7, key: 'spaces/original/attempts/old' };
test('native transport resolves original historical placement privately and authorizes every signed abort/delete without claiming physical completion', async () => {
  const calls: Array<{ url: string; method: string; authorization: string }> = [], resolutions: unknown[] = []; let grants = 0;
  const transport = objectDeletionTransport(async value => { resolutions.push(value); return original; }, (async (url, init) => {
    calls.push({ url: String(url), method: String(init?.method), authorization: new Headers(init?.headers).get('authorization')! }); return new Response(null, { status: 204 });
  }) as typeof fetch);
  expect(await transport.location(location)).toEqual({ endpoint: original.endpoint, bucket: original.bucket, region: original.region });
  await transport.abort(location, 'aa'.repeat(32), AbortSignal.timeout(5000), async () => { grants++; });
  expect(await transport.remove(location, AbortSignal.timeout(5000), async () => { grants++; })).toBeUndefined();
  expect(grants).toBe(4); expect(resolutions).toHaveLength(3);
  expect(calls.map(row => row.url)).toEqual(['https://original.invalid/original-bucket/spaces/original/attempts/old?uploadId=' + 'aa'.repeat(32), 'https://original.invalid/original-bucket/spaces/original/attempts/old']);
  expect(calls.every(row => row.method === 'DELETE' && row.authorization.startsWith('AWS4-HMAC-SHA256 Credential=original-access/'))).toBe(true);
  expect(JSON.stringify(calls)).not.toContain('confidential-secret');
});
test('revoked grant, invalid original upload ID and failed response cannot become deletion or completion acknowledgements', async () => {
  let effects = 0; const transport = objectDeletionTransport(async () => original, async () => { effects++; return new Response(null, { status: 500 }); });
  await expect(transport.remove(location, AbortSignal.timeout(5000), async () => { throw Error('revoked'); })).rejects.toThrow('revoked');
  await expect(transport.abort(location, '../foreign', AbortSignal.timeout(5000), async () => undefined)).rejects.toThrow('身份无效'); expect(effects).toBe(0);
  await expect(transport.remove(location, AbortSignal.timeout(5000), async () => undefined)).rejects.toThrow('尚未确认'); expect(effects).toBe(1);
  const invalid = objectDeletionTransport(async () => ({ ...original, endpoint: 'https://username:password@foreign.invalid' }));
  await expect(invalid.location(location)).rejects.toThrow();
  const cancel = new AbortController(); cancel.abort(); await expect(transport.remove(location, cancel.signal, async () => undefined)).rejects.toThrow(); expect(effects).toBe(1);
});
