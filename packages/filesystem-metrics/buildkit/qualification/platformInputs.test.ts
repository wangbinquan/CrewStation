import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm, link, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { observeBuildKitPlatformInputs } from './platformInputs';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'native-buildkit-input-')), templateRoot = join(root, 'template'), directory = 'original-cache';
  const snapshots = join(root, directory, 'runc-overlayfs/snapshots/snapshots');
  await mkdir(join(templateRoot, 'source'), { recursive: true }); await writeFile(join(templateRoot, 'Dockerfile'), 'FROM scratch\n'); await writeFile(join(templateRoot, 'source/app.ts'), 'console.log("template");\n');
  await writeFile(join(templateRoot, '.gitignore'), 'node_modules\n');
  for (const id of ['2', '3']) { await mkdir(join(snapshots, id, 'fs/source'), { recursive: true }); await writeFile(join(snapshots, id, 'fs/Dockerfile'), 'FROM scratch\n'); await writeFile(join(snapshots, id, 'fs/source/app.ts'), id === '2' ? 'console.log("template");\n' : 'console.log("project");\n'); }
  for (const id of ['2', '3']) await writeFile(join(snapshots, id, 'fs/.gitignore'), 'node_modules\n');
  return { root, templateRoot, directory, snapshots, input: { key: 'original', directory, storageIds: ['2', '3'] } };
}
test('full original snapshot and independent template EOF distinguish identical platform input from project content', async () => {
  const f = await fixture();
  try {
    const proof = await observeBuildKitPlatformInputs(f, f.input); expect(proof.complete).toBe(true); expect(proof.physicalReclamationProven).toBe(false);
    expect(proof.inputs.map(row => [row.storageId, row.sharedPlatformContentsProven])).toEqual([['2', true], ['3', false]]);
    expect(proof.inputs[0]!.files.map(row => row.path)).toEqual(['.gitignore', 'Dockerfile', 'source', 'source/app.ts']);
    expect(await observeBuildKitPlatformInputs(f, f.input)).toMatchObject({ identity: proof.identity });
    await writeFile(join(f.templateRoot, 'Dockerfile'), 'FROM different\n');
    const changed = await observeBuildKitPlatformInputs(f, f.input); expect(changed.identity).not.toBe(proof.identity); expect(changed.inputs.every(row => !row.sharedPlatformContentsProven)).toBe(true);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test('links, caller path escapes, duplicate native IDs and empty independent templates never establish platform sharing', async () => {
  const f = await fixture();
  try {
    await symlink(f.templateRoot, join(f.snapshots, '2/fs/outside')); await expect(observeBuildKitPlatformInputs(f, f.input)).rejects.toThrow(); await rm(join(f.snapshots, '2/fs/outside'));
    await link(join(f.snapshots, '2/fs/Dockerfile'), join(f.snapshots, '2/fs/alias')); await expect(observeBuildKitPlatformInputs(f, f.input)).rejects.toThrow('aliases'); await rm(join(f.snapshots, '2/fs/alias'));
    await expect(observeBuildKitPlatformInputs(f, { ...f.input, directory: '..' })).rejects.toThrow();
    await expect(observeBuildKitPlatformInputs(f, { ...f.input, storageIds: ['2', '2'] })).rejects.toThrow();
    await rm(f.templateRoot, { recursive: true }); await mkdir(f.templateRoot); await expect(observeBuildKitPlatformInputs(f, f.input)).rejects.toThrow('empty');
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
