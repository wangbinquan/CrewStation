import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, link, symlink, open, rm, lstat } from 'node:fs/promises';
import { renameSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { measureDirectory } from './measure';
import { createFilesystemMetricsHandler } from './server';
const roots: string[] = [], token = 'a'.repeat(48);
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function directory() { const root = await mkdtemp(join(tmpdir(), 'cs-metrics-')); roots.push(root); await mkdir(join(root, 'volume'), { mode: 0o700 }); return root; }
test('allocated blocks match du, deduplicate hardlinks, and do not read sparse sizes or symlink targets', async () => {
  const root = await directory(), volume = join(root, 'volume');
  await writeFile(join(volume, 'data'), Buffer.alloc(128 * 1024, 42)); await link(join(volume, 'data'), join(volume, 'hardlink'));
  await writeFile(join(root, 'outside'), Buffer.alloc(512 * 1024, 4)); await symlink('../outside', join(volume, 'symlink'));
  const sparse = await open(join(volume, 'sparse'), 'w'); await sparse.truncate(1_073_741_824); await sparse.close();
  const value = BigInt(await measureDirectory(root, 'volume', AbortSignal.timeout(5000)));
  const du = Bun.spawn(['du', '-sk', volume], { stdout: 'pipe', stderr: 'pipe' }), output = await new Response(du.stdout).text(); expect(await du.exited).toBe(0);
  expect(value).toBe(BigInt(output.trim().split(/\s+/)[0]!) * 1024n); expect(value < 512n * 1024n).toBe(true);
  expect((await lstat(join(volume, 'data'))).size).toBe(128 * 1024);
});
test('invalid paths, symlinked directories and cancellation never scan targets', async () => {
  const root = await directory(); await symlink('volume', join(root, 'alias'));
  for (const path of ['', '../outside', 'volume/../', '/volume', 'volume//x', 'volume/./x', 'x\0y', 'alias', 'missing']) await expect(measureDirectory(root, path, AbortSignal.timeout(5000))).rejects.toThrow();
  await expect(measureDirectory('relative', 'volume', AbortSignal.timeout(1000))).rejects.toThrow('Invalid');
  await expect(measureDirectory(root, 'volume', AbortSignal.abort())).rejects.toThrow();
});
test('probe protocol authenticates, bounds requests, isolates target failures and coalesces concurrent scans', async () => {
  const root = await directory(), handler = createFilesystemMetricsHandler({ token, roots: { local: root } });
  const request = (body: unknown, path = '/measure', authorization = `Bearer ${token}`) => new Request(`http://probe${path}`, { method: 'POST', headers: { authorization }, body: JSON.stringify(body) });
  expect(() => createFilesystemMetricsHandler({ token: 'short', roots: {} })).toThrow();
  expect((await handler(new Request('http://probe/healthz'))).status).toBe(200);
  expect((await handler(request({}, '/measure', 'bad'))).status).toBe(401); expect((await handler(request({}, '/other'))).status).toBe(404);
  expect((await handler(request({ targets: [] }))).status).toBe(400);
  expect((await handler(new Request('http://probe/measure', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-length': '20000' }, body: '{}' }))).status).toBe(413);
  expect((await handler(request({ padding: 'x'.repeat(20_000) }))).status).toBe(400);
  const targets = [{ key: 'ok', rootId: 'local', relativePath: 'volume' }, { key: 'unknown', rootId: 'unknown', relativePath: 'volume' }, { key: 'missing', rootId: 'local', relativePath: 'missing' }];
  const first = handler(request({ targets })), second = await handler(request({ targets })); expect(second.status).toBe(409);
  const response = await first, json = await response.json() as { items: { state: string; allocatedBytes?: string; reason?: string }[] };
  expect(response.status).toBe(200); expect(json.items[0]?.state).toBe('fresh'); expect(json.items[0]?.allocatedBytes).toBeDefined(); expect(json.items[1]?.reason).toBe('Unknown root'); expect(json.items[2]?.reason).toBe('ENOENT');
  expect(JSON.stringify(json)).not.toContain(root);
});

test('a directory replaced mid-scan is rejected even when its original descriptor stays readable', async () => {
  const root = await directory(); await writeFile(join(root, 'volume/data'), 'allocated');
  const signal = new AbortController().signal; let checks = 0;
  // Replace at the first child boundary, after the target descriptor was pinned.
  signal.throwIfAborted = () => { if (++checks === 4) { renameSync(join(root, 'volume'), join(root, 'previous')); mkdirSync(join(root, 'volume')); writeFileSync(join(root, 'volume/data'), 'replacement'); } };
  await expect(measureDirectory(root, 'volume', signal)).rejects.toThrow('changed');
  expect((await lstat(join(root, 'previous/data'))).size).toBe(9);
});
