import { afterEach, describe, expect, test } from 'bun:test';
import { IDENTITY_HEADERS } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import { forbidden } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import type { DevSessionModuleApi } from '../api/moduleApi';
import { botRoutes } from '../http/botRoutes';
import { botConversationFixture } from './botConversationFixture';
import { workspaceActor, workspaceTask } from './workspaceFixture';

const available = await testDatabaseAvailable();
let f: Awaited<ReturnType<typeof botConversationFixture>> | undefined;
afterEach(async () => { await f?.db.drop(); f = undefined; });
describe.skipIf(!available)('Bot HTTP contract with real message persistence', () => {
  test('read is nonmutating, acceptance is 202, repeated request is one receipt; malformed and unauthorized writes fail', async () => {
    f = await botConversationFixture(); const app = createApp({ name: 'bot-test' });
    app.route('/', botRoutes(f.botApi as unknown as DevSessionModuleApi, async () => false));
    const path = `/v2/dev-sessions/${workspaceTask}/bot`, headers = { [IDENTITY_HEADERS.userId]: workspaceActor.userId, 'content-type': 'application/json' };
    const read = await app.request(path, { headers });
    expect(read.status).toBe(200); expect(read.headers.get('cache-control')).toBe('no-store'); expect(await read.json()).toEqual({ conversation: null });
    expect((await app.request(path)).status).toBe(401);
    const input = { requestId: crypto.randomUUID(), expectedRevision: 0, content: 'one accepted turn' };
    for (const bad of [{ ...input, requestId: 'bad' }, { ...input, content: '' }, { ...input, unexpected: true }]) expect((await app.request(path + '/messages', { method: 'POST', headers, body: JSON.stringify(bad) })).status).toBe(400);
    const send = () => app.request(path + '/messages', { method: 'POST', headers, body: JSON.stringify(input) });
    const accepted = await send(), repeated = await send(); expect(accepted.status).toBe(202); expect(await accepted.json()).toEqual(await repeated.json());
    expect((await f.current()).pendingMessage?.content).toBe(input.content);
    expect((await app.request(path + '/history?limit=101', { headers })).status).toBe(400);
    f.deps.authorizer.authorize = async () => { throw forbidden(); };
    expect((await send()).status).toBe(403); expect((await app.request(path, { headers })).status).toBe(403);
    expect(f.starts.rows.size).toBe(0);
  });
});
