import { expect, test } from 'bun:test';
import { mkdir, open, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { observeFileConsumers } from './consumers';
import { consumerFixture } from './consumerFixture';

test('a reused inode with a different known birth is excluded while the original birth and legacy pair remain conservative', () => consumerFixture(async f => {
  const process = await f.process('22'); await symlink(f.file, join(process, 'fd/7'));
  const birthtimeNs = String((await stat(f.file, { bigint: true })).birthtimeNs);
  expect(BigInt(birthtimeNs)).toBeGreaterThan(0n);
  const original = { ...f.identity, birthtimeNs }, replaced = { ...original, birthtimeNs: String(BigInt(birthtimeNs) + 1n) };
  expect((await observeFileConsumers([replaced], f.root)).consumers).toEqual([]);
  expect((await observeFileConsumers([original], f.root)).consumers).toHaveLength(1);
  expect((await observeFileConsumers([f.identity], f.root)).consumers).toHaveLength(1);
  expect((await observeFileConsumers([replaced, original], f.root)).consumers).toHaveLength(1);
  const unreadable = { ...original, birthtimeNs: '0' };
  await expect(observeFileConsumers([unreadable], f.root)).rejects.toThrow('Invalid retained file identity');
}));

test('known birth covers nonleader descriptor tables and cwd, root and executable references', () => consumerFixture(async f => {
  const process = await f.process('22'), thread = await f.thread('22', '24');
  await symlink(f.file, join(thread, 'fd/9'));
  for (const name of ['cwd', 'root', 'exe']) await symlink(f.file, join(process, name));
  const birthtimeNs = String((await stat(f.file, { bigint: true })).birthtimeNs), original = { ...f.identity, birthtimeNs };
  const held = await observeFileConsumers([original], f.root);
  expect(held.complete).toBe(true); expect(held.consumers.map(row => row.kind).sort()).toEqual(['cwd', 'descriptor', 'executable', 'root']);
  expect(held.consumers.find(row => row.kind === 'descriptor')?.tid).toBe(24);
  const replaced = { ...original, birthtimeNs: String(BigInt(birthtimeNs) + 1n) };
  expect((await observeFileConsumers([replaced], f.root)).consumers).toEqual([]);
}));

test('mapped original files require matching kernel birth metadata; missing or inconsistent mapping metadata fails closed', () => consumerFixture(async f => {
  const process = await f.process('22'), device = BigInt(f.identity.device);
  const major = ((device >> 8n) & 0xfffn) | ((device >> 32n) & ~0xfffn), minor = (device & 0xffn) | ((device >> 12n) & ~0xffn);
  await writeFile(join(process, 'maps'), `7000-8000 r--p 0000 ${major.toString(16)}:${minor.toString(16)} ${f.identity.inode} /private-original (deleted)\n`);
  const original = { ...f.identity, birthtimeNs: String((await stat(f.file, { bigint: true })).birthtimeNs) };
  expect((await observeFileConsumers([original], f.root)).complete).toBe(false);
  await mkdir(join(process, 'map_files')); await symlink(f.file, join(process, 'map_files/7000-8000'));
  const held = await observeFileConsumers([original], f.root); expect(held.complete).toBe(true); expect(held.consumers).toHaveLength(1);
  expect(held.consumers[0]?.kind).toBe('mapping'); expect(JSON.stringify(held)).not.toContain('private-original');
  const replaced = { ...original, birthtimeNs: String(BigInt(original.birthtimeNs) + 1n) };
  expect((await observeFileConsumers([replaced], f.root)).consumers).toEqual([]);
  await rm(join(process, 'map_files/7000-8000')); await symlink(join(process, 'maps'), join(process, 'map_files/7000-8000'));
  expect((await observeFileConsumers([original], f.root)).complete).toBe(false);
}));

if (process.platform === 'linux') {
  test('an actual unlinked open file remains a consumer of its original birth', async () => {
    const { mkdtemp } = await import('node:fs/promises'), { tmpdir } = await import('node:os');
    const root = await mkdtemp(join(tmpdir(), 'native-consumer-birth-')), path = join(root, 'original');
    await writeFile(path, 'private bytes'); const handle = await open(path, 'r');
    try {
      const original = await handle.stat({ bigint: true }), identity = { device: String(original.dev), inode: String(original.ino), birthtimeNs: String(original.birthtimeNs) };
      await rm(path); const held = await observeFileConsumers([identity]);
      expect(held.consumers.some(row => row.pid === process.pid && row.kind === 'descriptor')).toBe(true);
      const replaced = { ...identity, birthtimeNs: String(original.birthtimeNs + 1n) };
      expect((await observeFileConsumers([replaced])).consumers.some(row => row.pid === process.pid)).toBe(false);
      await handle.close(); expect((await observeFileConsumers([identity])).consumers.some(row => row.pid === process.pid)).toBe(false);
    } finally { await handle.close().catch(() => {}); await rm(root, { recursive: true, force: true }); }
  });
}
