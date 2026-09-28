import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describeArchiveFile, MissingArchiveFile, openArchiveFile } from './secureFile';

const linux = process.platform === 'linux' && ['x64', 'arm64'].includes(process.arch);
describe.skipIf(!linux)('archive read confinement through Linux openat2', () => {
  let root: string;
  beforeAll(async () => { root = await mkdtemp(join(tmpdir(), 'cs-archive-')); });
  afterAll(async () => { await rm(root, { recursive: true, force: true }); });
  test('unicode files stream bounded chunks from one held descriptor and verify unchanged metadata', async () => {
    const path = '结果.txt', bytes = '只读产物'.repeat(40_000);
    await writeFile(join(root, path), bytes);
    const file = await openArchiveFile(root, path);
    try {
      const described = await describeArchiveFile(file);
      expect(described.size).toBe(Buffer.byteLength(bytes)); expect(described.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
      expect(await new Response(described.stream()).text()).toBe(bytes); await described.stable();
    } finally { await file.close(); }
  });
  test('all symlink components, absolute paths, traversals and private storage names are rejected', async () => {
    await symlink('/etc/passwd', join(root, 'link')); await symlink('/etc', join(root, 'directory-link'));
    for (const path of ['link', 'directory-link/passwd', '../etc/passwd', '/etc/passwd', '.crewstation/journal', 'a/../b']) await expect(openArchiveFile(root, path)).rejects.toThrow();
    await expect(openArchiveFile(root, 'missing')).rejects.toBeInstanceOf(MissingArchiveFile);
  });
  test('directory and FIFO selections cannot block or open special files for reading', async () => {
    await mkdir(join(root, 'directory'));
    const fifo = Bun.spawnSync(['mkfifo', join(root, 'fifo')]); expect(fifo.exitCode).toBe(0);
    await expect(openArchiveFile(root, 'directory')).rejects.toThrow('普通文件');
    await expect(openArchiveFile(root, 'fifo')).rejects.toThrow('普通文件');
  });
  test('same-length edits and truncation after hashing prevent confirmation', async () => {
    await writeFile(join(root, 'changing'), 'original'); const file = await openArchiveFile(root, 'changing');
    try {
      const source = await describeArchiveFile(file);
      await writeFile(join(root, 'changing'), 'modified'); await expect(source.stable()).rejects.toThrow('发生变化');
      await writeFile(join(root, 'changing'), 'short'); await expect(new Response(source.stream()).text()).rejects.toThrow();
    } finally { await file.close(); }
  });
  test('even a trusted root fd cannot authorize crossing into a mounted proc filesystem', async () => {
    await expect(openArchiveFile('/', 'proc/version')).rejects.toThrow('errno=18');
  });
});
test.skipIf(linux)('unsupported hosts fail closed instead of following ordinary paths', async () => {
  await expect(openArchiveFile('/tmp', 'file')).rejects.toThrow('Linux');
});
