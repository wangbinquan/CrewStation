import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, copyFile, rename, symlink, rm, stat } from 'node:fs/promises';
import { renameSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { observeFilesystemSource, filesystemSourceEpoch, SourceRequestSchema, SourceResponseSchema } from './source';
import { createFilesystemMetricsHandler } from './server';
const roots: string[] = [], token = 's'.repeat(48);
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'cs-source-epoch-')); roots.push(root);
  await mkdir(join(root, 'volume/pgdata/global'), { recursive: true });
  await writeFile(join(root, 'volume/pgdata/global/pg_control'), 'same server identifier');
  return { root, target: { key: 'original-pv', rootId: 'local', directory: 'volume', entries: [{ key: 'control', relativePath: 'pgdata/global/pg_control', kind: 'file' as const }, { key: 'pgdata', relativePath: 'pgdata', kind: 'directory' as const }] } };
}
test('metadata epochs stay stable across ordinary file writes and change for copied control files or replaced volumes', async () => {
  const { root, target } = await fixture(), first = await observeFilesystemSource(root, target);
  expect(SourceResponseSchema.safeParse(first).success).toBe(true);
  const control = join(root, 'volume/pgdata/global/pg_control');
  await writeFile(control, 'same server identifier updated');
  const afterWrite = await observeFilesystemSource(root, target);
  expect(afterWrite.items).toEqual(first.items); expect(afterWrite.volumeIdentity).toBe(first.volumeIdentity);
  await copyFile(control, join(root, 'replacement')); await rename(join(root, 'replacement'), control);
  const copied = await observeFilesystemSource(root, target);
  expect(copied.items[0]!.identity).not.toBe(first.items[0]!.identity); expect(copied.volumeIdentity).toBe(first.volumeIdentity);
  await rename(join(root, 'volume'), join(root, 'old-volume'));
  await mkdir(join(root, 'volume/pgdata/global'), { recursive: true }); await copyFile(join(root, 'old-volume/pgdata/global/pg_control'), control);
  const replaced = await observeFilesystemSource(root, target);
  expect(replaced.volumeIdentity).not.toBe(first.volumeIdentity); expect(replaced.items[1]!.identity).not.toBe(first.items[1]!.identity);
  expect((await stat(join(root, 'old-volume/pgdata/global/pg_control'))).size).toBe(30);
});
test('symlinks, missing paths, wrong kinds, traversal and unsupported source roots cannot produce an identity', async () => {
  const { root, target } = await fixture();
  await symlink('volume', join(root, 'alias')); await symlink('pgdata', join(root, 'volume/alias'));
  await symlink('pg_control', join(root, 'volume/pgdata/global/alias'));
  await expect(observeFilesystemSource(root, { ...target, directory: 'alias' })).rejects.toThrow();
  await expect(observeFilesystemSource('relative', target)).rejects.toThrow('Invalid');
  for (const relativePath of ['alias/global/pg_control', 'pgdata/global/alias', 'missing', 'pgdata/global']) await expect(observeFilesystemSource(root, { ...target, entries: [{ ...target.entries[0]!, relativePath }] })).rejects.toThrow();
  for (const relativePath of ['../outside', '/outside', 'pgdata//global', 'pgdata/./global', 'pgdata/../global', 'x\0y', 'a/'.repeat(12) + 'b']) expect(SourceRequestSchema.safeParse({ ...target, entries: [{ ...target.entries[0]!, relativePath }] }).success).toBe(false);
  expect(SourceRequestSchema.safeParse({ ...target, directory: '..' }).success).toBe(false);
  expect(SourceRequestSchema.safeParse({ ...target, entries: [target.entries[0], target.entries[0]] }).success).toBe(false);
  await expect(observeFilesystemSource(root, target, AbortSignal.abort())).rejects.toThrow();
});
test('a replacement while original descriptors remain open is rejected instead of returning a stale epoch', async () => {
  const { root, target } = await fixture(), signal = new AbortController().signal; let checks = 0;
  signal.throwIfAborted = () => { if (++checks === 5) {
    renameSync(join(root, 'volume'), join(root, 'previous'));
    mkdirSync(join(root, 'volume/pgdata/global'), { recursive: true }); writeFileSync(join(root, 'volume/pgdata/global/pg_control'), 'same server identifier');
  } };
  await expect(observeFilesystemSource(root, target, signal)).rejects.toThrow('changed');
  expect((await stat(join(root, 'previous/pgdata/global/pg_control'))).size).toBe(22);
});
test('filesystems without birth epochs or a valid inode cannot attest the original source', async () => {
  const { root } = await fixture(), original = await stat(root, { bigint: true });
  expect(filesystemSourceEpoch(original, 'directory')).toMatch(/^[a-f0-9]{64}$/);
  for (const fields of [{ birthtimeNs: 0n }, { ino: 0n }]) {
    const unsupported = Object.assign(Object.create(Object.getPrototypeOf(original)), original, fields) as typeof original;
    expect(() => filesystemSourceEpoch(unsupported, 'directory')).toThrow('unavailable');
  }
  expect(() => filesystemSourceEpoch(original, 'file')).toThrow('unavailable');
});
test('authenticated source protocol is bounded, contains no file contents, and leaves existing probe routes available', async () => {
  const { root, target } = await fixture(), handler = createFilesystemMetricsHandler({ token, roots: { local: root } });
  const request = (value: unknown, auth = `Bearer ${token}`) => new Request('http://probe/source', { method: 'POST', headers: { authorization: auth }, body: JSON.stringify(value) });
  expect((await handler(request(target, 'Bearer wrong'))).status).toBe(401);
  expect((await handler(request({ ...target, rootId: 'unknown' }))).status).toBe(400);
  expect((await handler(request({ ...target, extra: true }))).status).toBe(400);
  expect((await handler(request({ ...target, entries: Array.from({ length: 33 }, (_, index) => ({ ...target.entries[0], key: String(index) })) }))).status).toBe(400);
  expect((await handler(request({ padding: 'x'.repeat(20_000) }))).status).toBe(400);
  const first = handler(request(target)); expect((await handler(request(target))).status).toBe(409);
  const response = await first, body = await response.json(); expect(response.status).toBe(200); expect(SourceResponseSchema.safeParse(body).success).toBe(true);
  expect(JSON.stringify(body)).not.toContain('same server identifier'); expect(JSON.stringify(body)).not.toContain(root);
  const missing = await handler(request({ ...target, directory: 'missing' })); expect(missing.status).toBe(400);
  expect((await handler(request(target))).status).toBe(200);
  expect((await handler(new Request('http://probe/healthz'))).status).toBe(200);
});
