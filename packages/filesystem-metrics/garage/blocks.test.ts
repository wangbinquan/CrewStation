import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { observeGarageBlocks } from './blocks';

test('complete original block walk retains every old, compressed, corrupt and temporary copy while preserving foreign bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'garage-blocks-')), directory = 'original', hash = 'aa'.repeat(32), foreign = 'bb'.repeat(32);
  try {
    const names = [hash, hash + '.zst', hash + '.corrupted', hash + '.zst.corrupted', hash + '.tmp1234abcd'];
    for (const [i, name] of names.entries()) {
      const path = join(root, directory, i < 2 ? 'aa/aa' : 'old-layout'); await mkdir(path, { recursive: true }); await writeFile(join(path, name), 'original');
    }
    await writeFile(join(root, directory, 'old-layout', foreign), 'keep');
    const before = await readdir(join(root, directory, 'old-layout'));
    const result = await observeGarageBlocks(root, directory, [hash], AbortSignal.timeout(5000));
    expect(result.copies).toHaveLength(5); expect(new Set(result.copies.map(row => row.identity)).size).toBe(5);
    expect(result.copies.every(row => row.hash === hash && row.bytes === 8 && row.inode !== '0')).toBe(true);
    expect(result.readonly).toBe(true); expect(result.complete).toBe(true);
    expect(await readFile(join(root, directory, 'old-layout', foreign), 'utf8')).toBe('keep');
    expect(await readdir(join(root, directory, 'old-layout'))).toEqual(before);
    for (const name of names) await rm(join(root, directory, name === hash || name === hash + '.zst' ? 'aa/aa' : 'old-layout', name));
    expect((await observeGarageBlocks(root, directory, [hash], AbortSignal.timeout(5000))).copies).toHaveLength(0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('symlinks and unknown retained copy spellings cannot become complete absence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'garage-blocks-')), directory = 'original', hash = 'aa'.repeat(32);
  try {
    await mkdir(join(root, directory)); await writeFile(join(root, directory, hash + '.unrecognized'), 'keep');
    await expect(observeGarageBlocks(root, directory, [hash], AbortSignal.timeout(5000))).rejects.toThrow('unknown-copy');
    await rm(join(root, directory, hash + '.unrecognized')); await symlink('/private/tmp', join(root, directory, 'escape'));
    await expect(observeGarageBlocks(root, directory, [hash], AbortSignal.timeout(5000))).rejects.toThrow();
    await expect(observeGarageBlocks(root, '../escape', [], AbortSignal.timeout(5000))).rejects.toThrow('scope-invalid');
  } finally { await rm(root, { recursive: true, force: true }); }
});
