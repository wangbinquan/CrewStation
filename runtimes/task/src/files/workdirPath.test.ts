import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunnerCommandError } from '../commandError';
import { createWorkdirPaths, normalizeRelative } from './workdirPath';

describe('normalizeRelative', () => {
  test('规范化并拒绝绝对路径与 ..', () => {
    expect(normalizeRelative('')).toBe('.');
    expect(normalizeRelative('.')).toBe('.');
    expect(normalizeRelative('./a//b/')).toBe('a/b');
    expect(normalizeRelative('a/../b')).toBe('b');
    for (const bad of ['..', '../x', 'a/../../x', '/etc/passwd', '~/x', 'a\0b']) {
      expect(() => normalizeRelative(bad)).toThrow(RunnerCommandError);
    }
  });
});

describe('createWorkdirPaths', () => {
  test('realpath 容器、符号链接逃逸、cwd 解析', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cs-paths-'));
    const outside = await mkdtemp(join(tmpdir(), 'cs-paths-outside-'));
    try {
      await mkdir(join(dir, 'inner'));
      await writeFile(join(outside, 'f.txt'), 'x');
      await symlink(outside, join(dir, 'link-out'));
      await symlink(join(dir, 'inner'), join(dir, 'link-in'));
      const paths = await createWorkdirPaths(dir);
      expect(paths.root).toBe(await realpath(dir));
      const existing = await paths.resolveRelative('inner');
      expect(existing).toEqual({ absolute: join(paths.root, 'inner'), relative: 'inner', exists: true });
      const missing = await paths.resolveRelative('inner/new/file.txt');
      expect(missing.exists).toBe(false);
      expect(missing.absolute).toBe(join(paths.root, 'inner', 'new', 'file.txt'));
      const viaInnerLink = await paths.resolveRelative('link-in/deeper.txt');
      expect(viaInnerLink.absolute).toBe(join(paths.root, 'inner', 'deeper.txt'));
      await expect(paths.resolveRelative('link-out/f.txt')).rejects.toMatchObject({ code: 'path_denied' });
      await expect(paths.resolveRelative('link-out/new/x.txt')).rejects.toMatchObject({ code: 'path_denied' });
      await expect(paths.resolveRelative('link-out')).rejects.toMatchObject({ code: 'path_denied' });

      expect(await paths.resolveCwd()).toBe(paths.root);
      expect(await paths.resolveCwd('inner')).toBe(join(paths.root, 'inner'));
      expect(await paths.resolveCwd(join(paths.root, 'inner'))).toBe(join(paths.root, 'inner'));
      await expect(paths.resolveCwd('/')).rejects.toMatchObject({ code: 'path_denied' });
      await expect(paths.resolveCwd(outside)).rejects.toMatchObject({ code: 'path_denied' });
      await expect(paths.resolveCwd('link-out')).rejects.toMatchObject({ code: 'path_denied' });
      await expect(paths.resolveCwd('nope')).rejects.toMatchObject({ code: 'not_found' });
      await writeFile(join(dir, 'file'), 'x');
      await expect(paths.resolveCwd('file')).rejects.toMatchObject({ code: 'not_a_directory' });
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});
