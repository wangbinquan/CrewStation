import { describe, expect, test } from 'bun:test';
import { MAX_DEDUP_KEY_LENGTH, deriveDedupKey, fingerprint } from './dedupKey';

const headers = (init: Record<string, string>): Headers => new Headers(init);
const push = { object_kind: 'push', ref: 'refs/heads/main', before: 'a'.repeat(40), after: 'b'.repeat(40), checkout_sha: 'b'.repeat(40), project: { id: 7 } };

describe('deriveDedupKey', () => {
  test('优先用 idempotency-key，其次 x-gitlab-event-uuid', () => {
    const both = deriveDedupKey('gitlab.push', headers({ 'idempotency-key': 'idem-1', 'x-gitlab-event-uuid': 'uuid-1' }), push);
    expect(both).toEqual({ key: 'gitlab.push|idem:idem-1', source: 'idempotency-key' });
    const uuidOnly = deriveDedupKey('gitlab.push', headers({ 'X-Gitlab-Event-UUID': 'uuid-1' }), push);
    expect(uuidOnly).toEqual({ key: 'gitlab.push|uuid:uuid-1', source: 'event-uuid' });
  });

  test('两个头都没有时退回 payload 指纹', () => {
    const derived = deriveDedupKey('gitlab.push', headers({}), push);
    expect(derived.source).toBe('payload-fingerprint');
    expect(derived.key).toBe(`gitlab.push|sha256:${fingerprint(push)}`);
  });

  test('重投同一次事件算出同一个键：这正是 cs-events 去重所依赖的', () => {
    const first = deriveDedupKey('gitlab.push', headers({ 'x-gitlab-event-uuid': 'uuid-9' }), push);
    // 重投会换 X-Gitlab-Webhook-UUID 并可能补上别的头，事件 UUID 不变。
    const retry = deriveDedupKey('gitlab.push', headers({ 'x-gitlab-event-uuid': 'uuid-9', 'x-gitlab-webhook-uuid': 'differs-every-attempt' }), push);
    expect(retry.key).toBe(first.key);
    expect(deriveDedupKey('gitlab.push', headers({}), push).key).toBe(deriveDedupKey('gitlab.push', headers({}), { ...push })!.key);
  });

  test('不同事件类型、不同事件、不同来源都不会撞键', () => {
    const uuid = headers({ 'x-gitlab-event-uuid': 'u' });
    expect(deriveDedupKey('gitlab.push', uuid, push).key).not.toBe(deriveDedupKey('gitlab.tag-push', uuid, push).key);
    expect(deriveDedupKey('gitlab.push', headers({}), push).key)
      .not.toBe(deriveDedupKey('gitlab.push', headers({}), { ...push, after: 'c'.repeat(40) }).key);
    expect(deriveDedupKey('gitlab.push', headers({ 'idempotency-key': 'x' }), push).key)
      .not.toBe(deriveDedupKey('gitlab.push', headers({ 'x-gitlab-event-uuid': 'x' }), push).key);
  });

  test('空白与空值的头当作没给', () => {
    expect(deriveDedupKey('gitlab.push', headers({ 'idempotency-key': '   ' }), push).source).toBe('payload-fingerprint');
  });

  test('超长来源压成摘要而不是截断，长度不超过平台上限 200', () => {
    const long = deriveDedupKey('gitlab.merge-request.unapproved', headers({ 'idempotency-key': 'k'.repeat(400) }), push);
    expect(long.key.length).toBeLessThanOrEqual(MAX_DEDUP_KEY_LENGTH);
    expect(long.key.startsWith('gitlab.merge-request.unapproved|sha256:')).toBe(true);
    // 压缩后仍然一一对应：两个不同的超长键不会塌成同一个。
    const other = deriveDedupKey('gitlab.merge-request.unapproved', headers({ 'idempotency-key': 'k'.repeat(399) + 'z' }), push);
    expect(other.key).not.toBe(long.key);
    expect(deriveDedupKey('gitlab.push', headers({}), push).key.length).toBeLessThanOrEqual(MAX_DEDUP_KEY_LENGTH);
  });
});

describe('fingerprint', () => {
  test('只看标量字段：可变的嵌套结构不影响结果', () => {
    expect(fingerprint({ ...push, commits: [{ id: '1' }], repository: { name: 'demo' } })).toBe(fingerprint(push));
  });

  test('对象身份变化就变：MR 与议题靠 object_attributes 区分', () => {
    const mr = { object_kind: 'merge_request', object_attributes: { id: 1, iid: 3, action: 'open', updated_at: '2026-09-11 08:00:00 UTC' }, project: { id: 7 } };
    expect(fingerprint(mr)).not.toBe(fingerprint({ ...mr, object_attributes: { ...mr.object_attributes, updated_at: '2026-09-11 09:00:00 UTC' } }));
    expect(fingerprint(mr)).not.toBe(fingerprint({ ...mr, project: { id: 8 } }));
    expect(fingerprint(mr)).toBe(fingerprint({ ...mr }));
  });

  test('非对象 payload 不抛错', () => {
    expect(fingerprint(null)).toHaveLength(64);
    expect(fingerprint('nope')).toBe(fingerprint(null));
  });
});
