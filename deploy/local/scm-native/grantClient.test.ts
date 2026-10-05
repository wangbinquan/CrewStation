import { expect, test } from 'bun:test';
import { nativeDeletionGrantClient } from './grantClient';
import { grantsFixture } from './grantsFixture';

test('the controller permit is fresh, uncached, never redirects, and requires the exact success status', async () => {
  const f = grantsFixture(), requests: RequestInit[] = []; let status = 204;
  const fetcher = Object.assign(async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => { requests.push(init!); return new Response(null, { status }); }, { preconnect: fetch.preconnect });
  const check = nativeDeletionGrantClient({ url: 'http://controller/internal/project-deletion/grant', token: 'dedicated-token'.repeat(3), fetch: fetcher });
  await check(f.context, AbortSignal.timeout(1000)); status = 403;
  await expect(check(f.context, AbortSignal.timeout(1000))).rejects.toThrow('denied'); expect(requests).toHaveLength(2);
  expect(requests[0]!.redirect).toBe('error'); expect(JSON.parse(String(requests[0]!.body))).toEqual(f.context);
  for (const url of ['file:///tmp', 'http://user:password@host/internal/project-deletion/grant', 'http://host/other'])
    expect(() => nativeDeletionGrantClient({ url, token: 'dedicated-token'.repeat(3) })).toThrow();
});
