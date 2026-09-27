import { describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { mapEventType, allEventTypes } from './eventType';
import { deriveDedupKey } from './dedupKey';
import { deriveOccurredAt } from './occurredAt';
import { verifySignature } from './signature';
import { readDeploymentInfo } from '../platform/environment';

import { cases } from './webhookFixtures';
const repository = { id: 1 };

describe('GitHub protocol', () => {
  test('every supported event/action maps to a declared type', async () => {
    for (const { hook, type, payload } of cases) expect(mapEventType(hook, payload)).toEqual({ ok: true, eventType: type });
    const manifest = Bun.YAML.parse(await readFile(new URL('../../crewstation.yaml', import.meta.url), 'utf8')) as { spec: { produces: Array<{ eventType: string }> } };
    expect(manifest.spec.produces.map((item) => item.eventType).sort()).toEqual(allEventTypes().sort());
    expect([...new Set(cases.map((item) => item.type))].sort()).toEqual(allEventTypes().sort());
  });
  test('unsupported actions do not invent a type; supported events require object identities', () => {
    for (const hook of [null, 'unknown', 'issues', 'pull_request', 'workflow_run', 'issue_comment']) expect(mapEventType(hook, {})).toMatchObject({ ok: false });
    expect(mapEventType('workflow_run', { action: 'completed', workflow_run: { conclusion: 'cancelled' } })).toMatchObject({ ok: false, reason: 'Unsupported event or action' });
    for (const { hook, payload } of cases) {
      expect(mapEventType(hook, { ...payload, repository: null })).toMatchObject({ ok: false, invalid: true });
      const invalid = { ...payload } as Record<string, unknown>;
      delete invalid[hook === 'push' ? 'ref' : hook === 'issues' ? 'label' : hook === 'issue_comment' ? 'comment' : hook === 'pull_request_review_comment' ? 'pull_request' : hook];
      expect(mapEventType(hook, invalid).ok).toBe(false);
    }
    expect(mapEventType('push', null)).toMatchObject({ ok: false, invalid: true });
    expect(mapEventType('pull_request', { repository, action: 'closed', pull_request: { id: 1 } })).toMatchObject({ ok: false, invalid: true });
  });
  test('HMAC uses exact UTF-8 bytes and rejects malformed, wrong or missing signatures', () => {
    const bytes = new TextEncoder().encode('{ "text": "你好 👋" }');
    const signature = `sha256=${createHmac('sha256', 'secret').update(bytes).digest('hex')}`;
    expect(verifySignature(bytes, signature, 'secret').ok).toBe(true);
    for (const sig of [null, 'sha1=abc', 'sha256=zz', 'sha256=' + '0'.repeat(64)]) expect(verifySignature(bytes, sig, 'secret').ok).toBe(false);
    expect(verifySignature(bytes, signature, null).ok).toBe(false);
    expect(verifySignature(new TextEncoder().encode('{"text":"你好 👋"}'), signature, 'secret').ok).toBe(false);
  });
  test('delivery ID and fallback distinguish attempts while stable key sorting preserves redelivery', () => {
    const key = (payload: unknown, id?: string, type = 'github.push') => deriveDedupKey(type, new Headers({ 'x-github-event': 'push', ...(id ? { 'x-github-delivery': id } : {}) }), payload);
    expect(key({}, 'uuid')).toEqual(key({ changed: true }, 'uuid'));
    expect(key({}, 'uuid').key).not.toBe(key({}, 'uuid', 'github.tag-push').key);
    expect(key({}, 'x'.repeat(300)).key.length).toBeLessThanOrEqual(200);
    expect(key({ b: [1, { z: 2, a: 3 }], a: null })).toEqual(key({ a: null, b: [1, { a: 3, z: 2 }] }));
    expect(key({ workflow_run: { id: 1, run_attempt: 1 } }).key).not.toBe(key({ workflow_run: { id: 1, run_attempt: 2 } }).key);
    expect(key([1, 2]).key).not.toBe(key([2, 1]).key);
  });
  test('timestamps and platform environment preserve sane fallbacks', () => {
    const now = new Date('2026-09-27T00:00:00Z');
    expect(deriveOccurredAt(null, now)).toBe(now.toISOString());
    expect(deriveOccurredAt({ comment: { updated_at: 'bad', created_at: '2026-09-26T12:00:00Z' } }, now)).toBe('2026-09-26T12:00:00.000Z');
    expect(deriveOccurredAt({ head_commit: { timestamp: '2026-09-26T12:00:00Z' } }, now)).toBe('2026-09-26T12:00:00.000Z');
    expect(readDeploymentInfo({})).toMatchObject({ port: 3000, eventsBaseUrl: null, webhookSecret: null });
    expect(readDeploymentInfo({ PORT: '4000', CS_SERVICE_DOMAIN: 'svc.local/' })).toMatchObject({ port: 4000, eventsBaseUrl: 'http://events.svc.local' });
    expect(readDeploymentInfo({ PORT: '99999', EVENTS_BASE_URL: 'http://override///' })).toMatchObject({ port: 3000, eventsBaseUrl: 'http://override' });
  });
});
