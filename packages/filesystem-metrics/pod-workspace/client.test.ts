import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPodWorkspaceHandler } from './server';
import { createPodWorkspaceClient } from './client';

test('authenticated original kubelet client and handler scan actual bytes-free files; a caller cannot select roots or omit volumes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kubelet-transport-')), podUid = randomUUID(), token = 'original-token'.repeat(4), input = { key: 'original', podUid, volumes: ['work'] };
  try {
    await mkdir(join(root, podUid, 'volumes/kubernetes.io~empty-dir/work'), { recursive: true }); await writeFile(join(root, podUid, 'volumes/kubernetes.io~empty-dir/work/output'), 'private');
    const handler = createPodWorkspaceHandler({ root, token }), transport = (url: URL, init: RequestInit) => handler(new Request(url, init));
    const client = createPodWorkspaceClient({ baseUrl: 'http://original', token, fetch: transport }), current = await client.observe(input);
    expect(current.volumes[0]!.files).toHaveLength(2); expect(JSON.stringify(current)).not.toContain('private'); expect(current.physicalReclamationProven).toBe(false);
    await expect(createPodWorkspaceClient({ baseUrl: 'http://original', token: 'incorrect'.repeat(5), fetch: transport }).observe(input)).rejects.toThrow('unavailable');
    const bad = await handler(new Request('http://original/pod-workspace/inventory', { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: JSON.stringify({ ...input, root: '/another' }) })); expect(bad.status).toBe(503);
    await expect(client.observe({ ...input, volumes: [] })).rejects.toThrow('unavailable');
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('a complete transport cannot substitute the Pod birth, key or requested volumes; truncated JSON is denied', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kubelet-transport-')), podUid = randomUUID(), token = 'original-token'.repeat(4), input = { key: 'original', podUid, volumes: [] };
  try {
    const handler = createPodWorkspaceHandler({ root, token });
    for (const change of [{ podUid: randomUUID() }, { key: 'other' }, { volumes: [{ name: 'other', identity: null, files: [] }] }]) {
      const client = createPodWorkspaceClient({ baseUrl: 'http://original', token, fetch: async (url, init) => Response.json({ ...await (await handler(new Request(url, init))).json(), ...change }) });
      await expect(client.observe(input)).rejects.toThrow('changed');
    }
    await expect(createPodWorkspaceClient({ baseUrl: 'http://original', token, fetch: async () => new Response('{"version":') }).observe(input)).rejects.toThrow();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('kubelet reads wait for exact probe contention with the original scope and deadline; other failures stay closed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kubelet-contention-')), token = 'original-token'.repeat(4), input = { key: 'original', podUid: randomUUID(), volumes: [] };
  try {
    const handler = createPodWorkspaceHandler({ root, token }), signal = AbortSignal.timeout(1000), signals: AbortSignal[] = [], requests: string[] = [];
    const client = createPodWorkspaceClient({ baseUrl: 'http://original', token, fetch: async (url, init) => {
      signals.push(init.signal!); requests.push(String(init.body));
      return signals.length === 1 ? Response.json({ error: 'A measurement is already running' }, { status: 409 }) : handler(new Request(url, init));
    } });
    expect((await client.observe(input, signal)).complete).toBe(true); expect(signals).toEqual([signal, signal]); expect(new Set(requests).size).toBe(1);
    for (const body of [{ error: 'another conflict' }, { error: 'A measurement is already running', changed: true }]) {
      let reads = 0;
      await expect(createPodWorkspaceClient({ baseUrl: 'http://original', token, fetch: async () => { reads++; return Response.json(body, { status: 409 }); } }).observe(input)).rejects.toThrow('unavailable');
      expect(reads).toBe(1);
    }
    let reads = 0;
    await expect(createPodWorkspaceClient({ baseUrl: 'http://original', token, fetch: async () => { reads++; return Response.json({ error: 'A measurement is already running' }, { status: 409 }); } }).observe(input, AbortSignal.timeout(10))).rejects.toThrow();
    expect(reads).toBe(1);
    let cancelled = false;
    await expect(createPodWorkspaceClient({ baseUrl: 'http://original', token, fetch: async () => new Response(new ReadableStream({ cancel() { cancelled = true; } })) }).observe(input, AbortSignal.timeout(10))).rejects.toThrow();
    expect(cancelled).toBe(true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
