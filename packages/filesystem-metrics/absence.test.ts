import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { directoryAbsent } from './absence';
import { createFilesystemMetricsHandler } from './server';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true }); });
test('only a missing leaf proves absence; existing symlinks, missing roots and traversal cannot do so', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cs-reclaim-probe-')); roots.push(root);
  await mkdir(join(root, 'present')); await symlink('missing', join(root, 'alias'));
  expect(await directoryAbsent(root, 'missing')).toBe(true);
  expect(await directoryAbsent(root, 'present')).toBe(false);
  expect(await directoryAbsent(root, 'alias')).toBe(false);
  for (const path of ['..', '../missing', '/missing', 'sub/missing', '']) await expect(directoryAbsent(root, path)).rejects.toThrow();
  await expect(directoryAbsent(join(root, 'missing'), 'volume')).rejects.toThrow();
});
test('authenticated bounded probe returns keyed evidence, while errors never become absent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cs-reclaim-http-')); roots.push(root);
  const token = 't'.repeat(40), handler = createFilesystemMetricsHandler({ token, roots: { local: root } });
  const request = (rootId: string, authorization = `Bearer ${token}`) => new Request('http://probe/absence', { method: 'POST', headers: { authorization }, body: JSON.stringify({ key: 'pvc-uid/pv-uid', rootId, directory: 'gone' }) });
  expect((await handler(request('local', 'Bearer no'))).status).toBe(401);
  expect((await handler(request('unknown'))).status).toBe(400);
  const response = await handler(request('local'));
  expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ key: 'pvc-uid/pv-uid', absent: true });
});
