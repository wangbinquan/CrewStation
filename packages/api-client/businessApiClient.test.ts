import { expect, test } from 'bun:test';
import { createBusinessExecutionClient } from './businessApiClient';
import { ApiClientError } from './apiClientError';
import type { TraceId } from '@crewstation/contracts';

test('explicit body trace is forwarded through the gateway header without changing client defaults', async () => {
  const calls: Headers[] = [];
  const client = createBusinessExecutionClient({ headers: { 'X-CS-Trace-Id': 'a'.repeat(32), authorization: 'Bearer test' }, fetch: async (_url, init) => {
    calls.push(new Headers(init?.headers)); return Response.json({});
  } });
  await client.create({ requestKey: 'one', taskContractVersion: 'v1', traceId: 'b'.repeat(32) as TraceId });
  await client.get('task');
  expect(calls[0]!.get('x-cs-trace-id')).toBe('b'.repeat(32));
  expect(calls[0]!.get('authorization')).toBe('Bearer test');
  expect(calls[1]!.get('x-cs-trace-id')).toBe('a'.repeat(32));
});

test('business client carries request keys, generations, resume and materials without local defaults or retries', async () => {
  const requests: Array<{ url: string; method: string; body: unknown }> = [];
  const client = createBusinessExecutionClient({ baseUrl: 'https://api.service.example', fetch: async (url, init) => {
    requests.push({ url: String(url), method: init?.method ?? '', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return Response.json({ id: 'same-resource' });
  } });
  const input = { requestKey: 'node:1', kind: 'agent' as const, name: 'review', agentProfileId: 'profile', prompt: 'inspect', materialId: 'material', resumeSessionId: 'native', cwd: '/work/iso/review' };
  await client.submit('task', input);
  expect(requests[0]).toEqual({ url: 'https://api.service.example/v3/business-tasks/task/subtasks', method: 'POST', body: input });
  await client.pause('task', { requestKey: 'pause-1', expectedGeneration: 2 });
  expect(requests[1]?.body).toEqual({ requestKey: 'pause-1', expectedGeneration: 2 });
  await client.events('task', { after: 'cursor+/', limit: 200 });
  expect(new URL(requests[2]!.url).searchParams.get('after')).toBe('cursor+/');
  expect(client.eventStreamUrl('task', { after: 'cursor+/' })).toBe('https://api.service.example/v3/business-tasks/task/events/stream?after=cursor%2B%2F');
});

test('all mutations and reads use the service-domain v3 resource rather than the browser task API', async () => {
  const paths: string[] = [];
  const client = createBusinessExecutionClient({ fetch: async (url) => { paths.push(String(url)); return Response.json({}); } });
  const op = { requestKey: 'op', expectedGeneration: 1 }, exec = { requestKey: 'op', expectedAttempt: 1 };
  const lease = { instanceId: 'instance', expectedEpoch: 1, leaseId: 'lease' };
  await client.capabilities(); await client.create({ requestKey: 'create', taskContractVersion: 'app/1' }); await client.get('t');
  await client.subtasks('t'); await client.subtask('t', 's'); await client.output('t', 's');
  await client.retry('t', 's', { ...exec, resumePolicy: 'fresh' }); await client.cancel('t', 's', exec); await client.message('t', 's', { ...exec, content: 'continue' });
  await client.operation('t', 'operation'); await client.resume('t', op); await client.close('t', op); await client.material('t', { requestKey: 'm' });
  await client.file('t', { path: 'report.txt' }); await client.files('t'); await client.control(); await client.claim({ instanceId: 'instance' });
  await client.renew(lease); await client.release(lease); await client.activate({ ...lease, preparationDigest: 'a'.repeat(64) });
  await client.handoffReady({ ...lease, preparationDigest: 'a'.repeat(64), operationId: 'h', acceptedTaskContractVersions: ['app/1'] });
  expect(paths).toEqual([
    '/v3/business-execution/capabilities', '/v3/business-tasks', '/v3/business-tasks/t', '/v3/business-tasks/t/subtasks', '/v3/business-tasks/t/subtasks/s',
    '/v3/business-tasks/t/subtasks/s/output', '/v3/business-tasks/t/subtasks/s/retry', '/v3/business-tasks/t/subtasks/s/cancel', '/v3/business-tasks/t/subtasks/s/messages',
    '/v3/business-tasks/t/operations/operation', '/v3/business-tasks/t/resume', '/v3/business-tasks/t/close', '/v3/business-tasks/t/materials', '/v3/business-tasks/t/file?path=report.txt', '/v3/business-tasks/t/files',
    '/v3/business-execution/control', '/v3/business-execution/control/claim', '/v3/business-execution/control/renew', '/v3/business-execution/control/release',
    '/v3/business-execution/control/activate', '/v3/business-execution/control/handoffs/h/ready',
  ]);
});

test('quota backpressure is returned to the caller without automatic resubmission', async () => {
  let calls = 0;
  const client = createBusinessExecutionClient({ fetch: async () => { calls++; return Response.json({ error: { code: 'quota_exceeded', message: 'quota full' } }, { status: 429, headers: { 'Retry-After': '3' } }); } });
  await expect(client.create({ requestKey: 'original', taskContractVersion: 'app/1' })).rejects.toBeInstanceOf(ApiClientError);
  expect(calls).toBe(1);
});
