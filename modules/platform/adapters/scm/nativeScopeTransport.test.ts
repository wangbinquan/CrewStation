import { expect, test } from 'bun:test';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import type { ProjectDeletionContext } from '@crewstation/contracts';
import { ProjectIdSchema } from '@crewstation/contracts';
import { nativeScopeTransport } from './nativeScopeTransport';

const context = (): ProjectDeletionContext => ({ operationId: newResourceId(), generation: 1, phase: 'stop',
  target: { id: ProjectIdSchema.parse(newResourceId()), name: 'Original', slug: 'original', namespace: 'cs-original', kind: 'DigitalWorker', state: 'active', revision: '1',
    prodHost: 'original.example', previewHost: 'preview.original.example', serviceHost: 'original.service.example' },
  confirmed: { participant: 'scm', complete: true, revision: jsonHash('confirmed'), resources: [], blockers: [], references: [] } });
test('native mutation requests carry the current durable scope while independent reads remain ordinary SDK requests', async () => {
  const bodies: unknown[] = [], fetcher = Object.assign(async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body))); return new Response(null, { status: 204 });
  }, { preconnect: fetch.preconnect }) as typeof fetch;
  const transport = nativeScopeTransport(fetcher), grant = context();
  const call = (path: string, query: unknown) => transport.fetch('http://native.test' + path, { method: 'POST', body: JSON.stringify(query) });
  await call('/native/gitlab/destruction', { mode: 'observe', original: 'read-only' });
  await expect(call('/native/gitlab/fence', { project: 'unadmitted' })).rejects.toThrow('许可');
  await transport.run(grant, [], () => call('/native/gitlab/fence', { project: 'approved' }));
  expect(bodies).toEqual([{ mode: 'observe', original: 'read-only' }, { context: grant, materials: [], request: { project: 'approved' } }]);
  await expect(call('/native/gitlab/storage/remove', {})).rejects.toThrow('许可');
});
test('concurrent operations retain separate contexts and caller changes do not alter a pending native grant', async () => {
  const received: Array<{ context: ProjectDeletionContext }> = [];
  const fetcher = Object.assign(async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    received.push(JSON.parse(String(init?.body))); return new Response(null, { status: 204 });
  }, { preconnect: fetch.preconnect }) as typeof fetch;
  const transport = nativeScopeTransport(fetcher), first = context(), second = context(), original = structuredClone(first);
  let resume!: () => void;
  const paused = new Promise<void>(resolve => { resume = resolve; });
  const a = transport.run(first, [], async () => { await paused; return transport.fetch('http://native.test/native/gitlab/fence', { body: '{}' }); });
  first.generation = 9;
  const b = transport.run(second, [], () => transport.fetch('http://native.test/native/gitlab/fence', { body: '{}' }));
  await b; resume(); await a;
  expect(received.map(row => row.context)).toEqual([second, original]);
  expect(() => transport.run({ ...second, phase: 'metadata' }, [], async () => {})).toThrow();
  expect(() => transport.run(second, undefined, async () => {})).toThrow();
  expect(() => transport.run(second, [{ contents: '{}' }], async () => {})).toThrow();
});
