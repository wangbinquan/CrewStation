import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { declaredDependencies } from '../rules/declaredDependencies';
import { sizeAndNaming } from '../rules/sizeAndNaming';
import { readSourceText, readText, walk } from '../sourceFiles';
import { loadWorkspace } from '../workspace';
import { createViolatingWorkspace } from './fixtureWorkspace';
import snapshots from './fixtures/sourceSnapshots.json';

// Keep the original complete file population and symlink behavior while avoiding duplicate metadata IO.
test('walk visits ordinary and linked files and directories, keeps every original skipped name and broken-link error', () => {
  const base = mkdtempSync(join(tmpdir(), 'crewstation-arch-walk-'));
  try {
    const root = join(base, 'scan'), outside = join(base, 'outside');
    mkdirSync(join(root, 'real'), { recursive: true }); mkdirSync(outside);
    writeFileSync(join(root, 'real/source.ts'), 'source'); writeFileSync(join(root, 'plain.txt'), 'plain');
    writeFileSync(join(outside, 'linked.ts'), 'linked');
    symlinkSync(outside, join(root, 'linked-directory'), 'dir'); symlinkSync(join(outside, 'linked.ts'), join(root, 'linked-file.ts'), 'file');
    for (const name of ['node_modules', 'dist', '.git', 'coverage', 'build']) { mkdirSync(join(root, name)); writeFileSync(join(root, name, 'hidden.ts'), 'hidden'); }
    const paths: string[] = []; walk(root, (path) => paths.push(relative(root, path)));
    expect(paths.sort()).toEqual(['linked-directory/linked.ts', 'linked-file.ts', 'plain.txt', 'real/source.ts']);
    symlinkSync(join(base, 'missing'), join(root, 'broken'), 'file');
    expect(() => walk(root, () => {})).toThrow();
  } finally { rmSync(base, { recursive: true, force: true }); }
});

// A fresh load must observe the changed original source; no cache can carry old text across workspace scans.
test('one workspace reads coherent source text and a new workspace sees edited imports, lines and original rule violations', () => {
  const root = createViolatingWorkspace();
  try {
    const path = join(root, 'packages/kernel/fresh.ts'); writeFileSync(path, snapshots.before);
    const first = loadWorkspace(root), file = first.byPath.get(path)!;
    expect(file.lines).toBe(2); expect(file.imports).toEqual([]); expect(readSourceText(file)).toBe(snapshots.before);
    writeFileSync(path, snapshots.after);
    expect(readText(path)).toBe(snapshots.after); expect(readSourceText(file)).toBe(snapshots.before);
    expect(sizeAndNaming(first).filter((row) => row.file === path)).toEqual([]);
    // An externally constructed SourceFile retains the original readText fallback.
    expect(readSourceText({ ...file })).toBe(snapshots.after);
    const second = loadWorkspace(root), updated = second.byPath.get(path)!;
    expect(updated).not.toBe(file); expect(updated.lines).toBe(3); expect(readSourceText(updated)).toBe(snapshots.after);
    expect(updated.imports.map((row) => row.spec)).toEqual(['new-dependency']);
    expect(sizeAndNaming(second).filter((row) => row.file === path).map((row) => row.rule)).toEqual(['no-default-export']);
    expect(declaredDependencies(second).filter((row) => row.file === path).map((row) => row.message).join()).toContain('new-dependency');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
