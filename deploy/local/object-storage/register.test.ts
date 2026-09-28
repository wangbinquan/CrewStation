import { afterEach, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dispose: (() => void)[] = [];
afterEach(() => { for (const close of dispose.splice(0).reverse()) close(); });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'cs-object-register-')); dispose.push(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'kubectl'), `#!/usr/bin/env bun
const args = process.argv.slice(2).join(' ');
if (!args.includes('--context docker-desktop')) process.exit(8);
const values = args.includes('garage-observation') ? {CS_GARAGE_OBSERVATION_TOKEN:'scope.readonly'} : {GARAGE_DEFAULT_BUCKET:'private-bucket',GARAGE_DEFAULT_ACCESS_KEY:'private-key',GARAGE_DEFAULT_SECRET_KEY:'private-secret'};
console.log(JSON.stringify({data:Object.fromEntries(Object.entries(values).map(([k,v]) => [k,Buffer.from(v).toString('base64')]))}));
`); chmodSync(join(dir, 'kubectl'), 0o755);
  const state = { backend: null as Record<string, unknown> | null, plans: [] as Record<string, unknown>[], fail: false, admin: true };
  const calls: { path: string; method: string; body?: Record<string, unknown> }[] = [];
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === '/auth/login') return Response.json({ user: { isAdmin: state.admin } }, { headers: { 'set-cookie': 'sid=test-only; HttpOnly; Path=/' } });
    if (req.headers.get('cookie') !== 'sid=test-only') return new Response(null, { status: 401 });
    const body = req.method === 'POST' && path !== '/auth/logout' ? await req.json() as Record<string, unknown> : undefined;
    calls.push({ path, method: req.method, body });
    if (path === '/auth/logout') return new Response(null, { status: 204 });
    if (state.fail && req.method === 'POST') return new Response('secret must not leak', { status: 503 });
    if (path.endsWith('/backends') && req.method === 'POST') { state.backend = { ...body, id: Bun.randomUUIDv7() }; return Response.json(state.backend, { status: 201 }); }
    if (path.endsWith('/backends')) return Response.json({ items: state.backend ? [state.backend] : [] });
    if (path.endsWith('/plans') && req.method === 'POST') { state.plans.push({ ...body, id: Bun.randomUUIDv7() }); return Response.json(state.plans.at(-1), { status: 201 }); }
    if (path.endsWith('/plans')) return Response.json({ items: state.plans });
    return new Response(null, { status: 404 });
  } }); dispose.push(() => server.stop(true));
  const run = async () => {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, 'register.ts')], { env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CS_CONSOLE_URL: server.url.toString().replace(/\/$/, ''), CS_ADMIN_USERNAME: 'admin', CS_ADMIN_PASSWORD: 'test-password' }, stdout: 'pipe', stderr: 'pipe' });
    const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]); return { code, out, err };
  };
  return { state, calls, run };
}
test('local registration authenticates, seeds once and keeps later administrator edits and project grants', async () => {
  const f = fixture(), first = await f.run(); expect(first.code, first.err).toBe(0);
  expect(f.state.backend).toMatchObject({ durability: 'dev-only', monitoring: { token: 'scope.readonly' }, budgetBytes: 60 * 1024 ** 3 });
  expect(f.state.plans).toHaveLength(1); expect(f.state.plans[0]).toMatchObject({ quotaBytes: 20 * 1024 ** 3, maxConcurrentTransfers: 4 });
  f.state.backend!.state = 'no-new-writes'; f.state.plans[0]!.enabled = false; f.calls.length = 0;
  const second = await f.run(); expect(second.code).toBe(0);
  expect(f.calls.filter((c) => c.method !== 'GET').map((c) => c.path)).toEqual(['/auth/logout']);
  expect(f.state.backend!.state).toBe('no-new-writes'); expect(f.state.plans[0]!.enabled).toBe(false);
  expect(`${first.out}${first.err}${second.out}${second.err}`).not.toContain('private-secret');
});
test('failed registration is visible, redacted and logs out; the next attempt uses the same request key', async () => {
  const f = fixture(); f.state.fail = true;
  const failed = await f.run(); expect(failed.code).toBe(1); expect(failed.err).toContain('HTTP 503'); expect(failed.err).not.toContain('secret must not leak');
  expect(f.calls.at(-1)?.path).toBe('/auth/logout'); const key = f.calls.find((c) => c.body)?.body?.requestKey;
  f.state.fail = false; expect((await f.run()).code).toBe(0);
  expect(f.calls.filter((c) => c.path.endsWith('/backends') && c.method === 'POST').at(-1)?.body?.requestKey).toBe(key);
});
