import { describe, expect, test } from 'bun:test';
import { mapEventType } from './eventType';
import { deriveDedupKey } from './dedupKey';
import { createApp } from '../main';

const note = (target = 'MergeRequest', text = 'Please fix') => ({ object_kind: 'note', project: { id: 7 }, object_attributes: { id: 41, noteable_type: target, note: text, action: 'create', created_at: '2026-09-27T00:00:00Z' }, merge_request: { id: 10, iid: 2 }, issue: { id: 11, iid: 3 } });
describe('RFC-033 GitLab comments', () => {
  test('MR and issue comments reach distinct event types, including edited notes', () => {
    for (const [target, type] of [['MergeRequest', 'gitlab.merge-request.comment'], ['Issue', 'gitlab.issue.comment']]) {
      const payload = note(target);
      expect(mapEventType('Note Hook', payload)).toMatchObject({ ok: true, eventType: type });
      payload.object_attributes.action = 'update';
      expect(mapEventType('Note Hook', payload)).toMatchObject({ ok: true, eventType: type });
    }
    expect(mapEventType('Note Hook', note('Commit'))).toMatchObject({ ok: false });
  });
  test('comment fingerprint separates edits and target objects but keeps replays stable', () => {
    const key = (p: unknown) => deriveDedupKey('gitlab.merge-request.comment', new Headers(), p).key;
    expect(key(note())).toBe(key(note()));
    expect(key(note())).not.toBe(key(note('MergeRequest', 'Changed')));
    const changed = note(); changed.merge_request.id = 99;
    expect(key(note())).not.toBe(key(changed));
  });
  test('invalid known comment returns 400; valid comment preserves payload and receipt', async () => {
    let received: unknown;
    const app = createApp({ env: { GITLAB_WEBHOOK_SECRET_TOKEN: 'test', EVENTS_BASE_URL: 'http://events' }, log: () => {}, eventsFetch: async (_url, init) => { received = JSON.parse(String(init?.body)); return Response.json({ eventId: 'event-1', deduplicated: false, deliveries: 1 }, { status: 202 }); } });
    const send = (p: unknown) => app.request('/hooks/gitlab', { method: 'POST', headers: { 'content-type': 'application/json', 'x-gitlab-token': 'test', 'x-gitlab-event': 'Note Hook' }, body: JSON.stringify(p) });
    expect((await send({ object_attributes: { noteable_type: 'Issue' } })).status).toBe(400);
    expect((await send(note())).status).toBe(202);
    expect(received).toMatchObject({ eventType: 'gitlab.merge-request.comment', payload: note() });
  });
});

test('GitLab never acknowledges a malformed persistence receipt', async () => {
  for (const result of [{ eventId: 'id' }, { eventId: 'id', deduplicated: false, deliveries: -1 }]) {
    const app = createApp({ env: { GITLAB_WEBHOOK_SECRET_TOKEN: 'test', EVENTS_BASE_URL: 'http://events' },
      log: () => {}, eventsFetch: async () => Response.json(result) });
    const response = await app.request('/hooks/gitlab', { method: 'POST', headers: { 'content-type': 'application/json', 'x-gitlab-token': 'test', 'x-gitlab-event': 'Note Hook' }, body: JSON.stringify(note()) });
    expect(response.status).toBe(503);
  }
});
