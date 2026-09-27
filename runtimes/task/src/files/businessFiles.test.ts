import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm, symlink, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createBusinessFiles } from './businessFiles';
import { businessPathOpener } from './businessPaths';
import type { OpenBusinessPath } from './businessPaths';

const cleanup: string[] = [];
afterEach(async () => { for (const dir of cleanup.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'cs-business-files-')); cleanup.push(root);
  // Exercise portable streaming/cursor code on the host; this adapter is NOT a security implementation.
  const hostFixture: OpenBusinessPath = async (path) => ({ fd: -1, descriptorPath: join(root, path), close() {} });
  return { root, files: createBusinessFiles(root, process.platform === 'linux' ? undefined : hostFixture) };
}

test('binary chunks use content hashes, bounded byte offsets and explicit version conflicts', async () => {
  const { root, files } = await fixture(), bytes = Buffer.alloc(2 * 1024 * 1024 + 137);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
  await writeFile(join(root, 'result.bin'), bytes);
  const version = createHash('sha256').update(bytes).digest('hex');
  let offset = 0;
  const result: Buffer[] = [];
  for (;;) {
    const chunk = await files.read({ path: 'result.bin', offset, limit: 1024 * 1024, ...(offset ? { version } : {}) });
    expect(chunk.version).toBe(version); expect(chunk.size).toBe(bytes.length);
    const content = Buffer.from(chunk.contentBase64, 'base64'); expect(content.length).toBeLessThanOrEqual(1024 * 1024); result.push(content);
    if (chunk.nextOffset === null) break;
    offset = chunk.nextOffset;
  }
  expect(Buffer.concat(result)).toEqual(bytes);
  await writeFile(join(root, 'result.bin'), 'new');
  await expect(files.read({ path: 'result.bin', offset: 0, limit: 5, version })).rejects.toMatchObject({ code: 'file_version_changed' });
  await expect(files.read({ path: 'result.bin', offset: 99, limit: 5, version })).rejects.toMatchObject({ code: 'invalid_offset' });
  await expect(files.read({ path: 'result.bin', offset: 1, limit: 5 })).rejects.toThrow('分块续读');
  await expect(files.read({ path: 'result.bin', offset: 0, limit: 1024 * 1024 + 1 })).rejects.toThrow();
  await writeFile(join(root, 'empty'), '');
  expect(await files.read({ path: 'empty', offset: 0, limit: 1 })).toMatchObject({ size: 0, contentBase64: '', nextOffset: null });
});

test('directory cursor pages in order, binds to directory/version, and omits reserved storage', async () => {
  const { root, files } = await fixture();
  await mkdir(join(root, 'child')); await mkdir(join(root, '.crewstation'));
  await Promise.all(['z', 'a', 'c', 'b', 'd'].map((name) => writeFile(join(root, name), name)));
  await symlink('a', join(root, 'link'));
  const first = await files.list({ path: '.', limit: 2 });
  expect(first.entries.map((e) => e.name)).toEqual(['a', 'b']); expect(first.nextCursor).not.toBeNull();
  const second = await files.list({ path: '.', limit: 2, after: first.nextCursor! });
  expect(second.entries.map((e) => e.name)).toEqual(['c', 'child']);
  const last = await files.list({ path: '.', limit: 20, after: second.nextCursor! });
  expect(last.entries.map((e) => [e.name, e.kind])).toEqual([['d', 'file'], ['link', 'symlink'], ['z', 'file']]); expect(last.nextCursor).toBeNull();
  await expect(files.list({ path: 'child', limit: 2, after: first.nextCursor! })).rejects.toMatchObject({ code: 'invalid_cursor' });
  await expect(files.list({ path: '.', limit: 2, after: 'garbage' })).rejects.toMatchObject({ code: 'invalid_cursor' });
  await writeFile(join(root, 'another'), 'new');
  await expect(files.list({ path: '.', limit: 2, after: first.nextCursor! })).rejects.toMatchObject({ code: 'file_version_changed' });
});

test('path syntax is checked before any descriptor is opened', async () => {
  const { root } = await fixture(); let opened = 0;
  const files = createBusinessFiles(root, async () => { opened++; throw new Error('unexpected open'); });
  for (const path of ['/etc/passwd', '../escape', 'a/../b', '.crewstation/key', 'a/.crewstation/key', 'a\\b', 'a\0b']) {
    await expect(files.read({ path, offset: 0, limit: 1 })).rejects.toThrow();
    await expect(files.list({ path, limit: 1 })).rejects.toThrow();
  }
  expect(opened).toBe(0);
});

test('native Linux descriptor lookup rejects escapes/special files and survives link replacement; other hosts fail closed', async () => {
  const { root } = await fixture(), open = businessPathOpener(root);
  await writeFile(join(root, 'inside'), 'inside');
  if (process.platform !== 'linux') {
    await expect(open('inside', 'file')).rejects.toMatchObject({ code: 'unsupported_capability' });
    return;
  }
  const files = createBusinessFiles(root);
  await mkdir(join(root, '.crewstation')); await writeFile(join(root, '.crewstation', 'secret'), 'private');
  await symlink('/etc/passwd', join(root, 'escape')); await symlink('.crewstation/secret', join(root, 'reserved'));
  await symlink('/dev/null', join(root, 'device')); await symlink('inside', join(root, 'link'));
  await symlink(join(root, 'inside'), join(root, 'absolute-inside'));
  for (const path of ['escape', 'reserved', 'device']) await expect(files.read({ path, offset: 0, limit: 100 })).rejects.toMatchObject({ code: 'path_denied' });
  for (const path of ['link', 'absolute-inside']) expect(Buffer.from((await files.read({ path, offset: 0, limit: 100 })).contentBase64, 'base64').toString()).toBe('inside');
  const pinned = await open('link', 'file');
  try {
    await rm(join(root, 'link')); await symlink('/etc/passwd', join(root, 'link'));
    await rename(join(root, 'inside'), join(root, 'old')); await writeFile(join(root, 'inside'), 'replacement');
    const anchored = createBusinessFiles(root, async () => ({ ...pinned, close() {} }));
    expect(Buffer.from((await anchored.read({ path: 'link', offset: 0, limit: 100 })).contentBase64, 'base64').toString()).toBe('inside');
    await expect(files.read({ path: 'link', offset: 0, limit: 100 })).rejects.toMatchObject({ code: 'path_denied' });
  } finally { pinned.close(); }
  await expect(open('.', 'file')).rejects.toMatchObject({ code: 'invalid_file_type' });
  await expect(open('inside', 'dir')).rejects.toMatchObject({ code: 'invalid_file_type' });
  expect(spawnSync('mkfifo', [join(root, 'pipe')]).status).toBe(0);
  await expect(open('pipe', 'file')).rejects.toMatchObject({ code: 'invalid_file_type' });
  // Each lookup races an atomic link replacement. A successful read must always be the in-workspace file.
  const mutate = async () => {
    for (let i = 0; i < 40; i++) { await symlink(i % 2 ? 'old' : '/etc/passwd', join(root, 'next')); await rename(join(root, 'next'), join(root, 'link')); }
  };
  const reads = async () => {
    for (let i = 0; i < 40; i++) {
      try { expect(Buffer.from((await files.read({ path: 'link', offset: 0, limit: 100 })).contentBase64, 'base64').toString()).toBe('inside'); }
      catch (error) { expect(error).toMatchObject({ code: 'path_denied' }); }
    }
  };
  await Promise.all([mutate(), reads()]);
});
