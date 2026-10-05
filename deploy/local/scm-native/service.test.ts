import { expect, test } from 'bun:test';
import { nativeGitlabService } from './service';
import { grantsFixture } from './grantsFixture';
import type { GitLabDestructionRequest } from '../../../packages/gitlab-client';

const token = 'dedicated-native-private-source-token'.repeat(2);
function fixture() {
  const f = grantsFixture(), input = { ...f, token, roots: f.native.roots,
    native: { inspect: async () => f.instance, read: async () => 'CS_GITLAB_NATIVE=' + JSON.stringify(f.native) },
    fence: { inspect: async () => f.instance, fence: async () => { f.calls.push('fence-effect'); return ''; } },
    removal: { inspect: async () => f.instance, remove: async () => { f.calls.push('remove-effect'); return ''; } },
    destruction: { ...f.destruction, run: async (request: GitLabDestructionRequest) => {
      if (request.mode !== 'observe') { f.calls.push(request.mode + '-effect'); f.state.parent = 0; }
      return f.destruction.run(request);
    } },
  };
  const handler = nativeGitlabService(input), query = { mode: 'destroy', original: f.native };
  const request = (value: unknown = { context: f.context, materials: [f.material], request: query }, credential = token) => new Request('http://native/native/gitlab/destruction', {
    method: 'POST', headers: { authorization: 'Bearer ' + credential }, body: typeof value === 'string' ? value : JSON.stringify(value),
  });
  return { ...f, input, handler, query, request };
}
test('production service routes an admitted original deletion through the native SDK guards; unwrapped reads remain read-only', async () => {
  const f = fixture();
  expect((await f.handler(f.request({ mode: 'observe', original: f.native }))).status).toBe(200);
  expect(f.calls).toEqual(['observe']); f.calls.length = 0;
  const response = await f.handler(f.request()); expect(response.status).toBe(200);
  const result = await response.json() as { receipt: { nativeRemaining: number } }; expect(result.receipt.nativeRemaining).toBe(0);
  expect(f.calls).toEqual(['grant:1', 'observe', 'footprint', 'activity', 'grant:1', 'destroy-effect', 'destroy']);
});
test('unauthenticated requests, ordinary SDK writes, injected commands, lost permits and active consumers execute no mutation', async () => {
  for (const mode of ['auth', 'plain', 'command', 'stale', 'busy', 'malformed', 'budget']) {
    const f = fixture(); let request = f.request();
    if (mode === 'auth') request = f.request(undefined, 'wrong');
    if (mode === 'plain') request = f.request(f.query);
    if (mode === 'command') request = f.request({ context: f.context, materials: [f.material], request: { ...f.query, command: 'rm -rf /' } });
    if (mode === 'stale') f.state.denied = true;
    if (mode === 'busy') f.state.producer = 1;
    if (mode === 'malformed') request = f.request('{');
    if (mode === 'budget') request = f.request('x'.repeat(25_165_825));
    expect((await f.handler(request)).status).toBeGreaterThanOrEqual(400);
    expect(f.calls).not.toContain('destroy-effect'); expect(f.state.parent).toBe(1);
  }
  const f = fixture(); expect((await f.handler(new Request('http://native/missing'))).status).toBe(404);
  expect((await f.handler(new Request('http://native/native/gitlab/destruction'))).status).toBe(405);
});
test('mutations serialize across endpoints while the original persistent grant is pending', async () => {
  const f = fixture(); let begin!: () => void, resume!: () => void;
  const entered = new Promise<void>(resolve => { begin = resolve; }), pending = new Promise<void>(resolve => { resume = resolve; });
  const handler = nativeGitlabService({ ...f.input, assertGrant: async () => { begin(); await pending; } });
  const first = handler(f.request()); await entered;
  const { archived: _a, registryEnabled: _r, ...project } = f.native.project;
  const second = new Request('http://native/native/gitlab/fence', { method: 'POST', headers: { authorization: 'Bearer ' + token },
    body: JSON.stringify({ context: f.context, materials: [f.material], request: { project, credentials: f.material.native.credentials } }) });
  expect((await handler(second)).status).toBe(409); resume(); expect((await first).status).toBe(200);
  expect(f.calls.filter(row => row === 'destroy-effect')).toHaveLength(1); expect(f.calls).not.toContain('fence-effect');
});
