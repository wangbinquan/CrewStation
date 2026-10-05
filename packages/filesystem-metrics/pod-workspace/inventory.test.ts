import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, symlink, open } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { observePodWorkspaces } from './inventory';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kubelet-original-')), podUid = randomUUID(), foreign = randomUUID();
  const empty = join(root, podUid, 'volumes/kubernetes.io~empty-dir'), workspace = join(empty, 'workspace');
  await mkdir(join(workspace, '.git'), { recursive: true }); await writeFile(join(workspace, '.git/config'), 'private credential must never be read');
  await mkdir(join(empty, 'socket')); await mkdir(join(root, foreign));
  return { root, podUid, foreign, empty, workspace, query: { key: 'actual-original', podUid, volumes: ['workspace', 'socket'] } };
}
test('complete original kubelet emptyDir trees retain all births and hidden files without reading content or treating API absence as reclaimed storage', async () => {
  const f = await fixture();
  try {
    const current = await observePodWorkspaces(f.root, f.query); expect(current.complete).toBe(true); expect(current.physicalReclamationProven).toBe(false);
    expect(current.allPodUids).toEqual([f.podUid, f.foreign].sort()); expect(current.volumes[0]!.files.map(row => row.path)).toEqual(['', '.git', '.git/config']);
    expect(JSON.stringify(current)).not.toContain('private credential'); expect(await observePodWorkspaces(f.root, f.query)).toMatchObject({ revision: current.revision });
    const fd = await open(join(f.workspace, '.git/config'), 'r'), original = current.volumes[0]!.files.find(row => row.kind === 'file')!;
    await rm(join(f.root, f.podUid), { recursive: true });
    const gone = await observePodWorkspaces(f.root, f.query); expect(gone.podIdentity).toBeNull(); expect(gone.volumes.every(row => row.identity === null && !row.files.length)).toBe(true);
    // Physical absence does not erase the retained unlinked inode: the host
    // consumer source must still inspect this original device/inode later.
    const held = await fd.stat({ bigint: true }); expect(String(held.ino)).toBe(original.inode); expect(String(held.dev)).toBe(original.device); await fd.close();
    await mkdir(f.workspace, { recursive: true }); await writeFile(join(f.workspace, 'replacement'), 'new');
    expect((await observePodWorkspaces(f.root, f.query)).podIdentity).not.toBe(current.podIdentity);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test('fixed kubelet scope rejects substituted roots, omitted volumes and path escapes; symlinks remain metadata only', async () => {
  const f = await fixture();
  try {
    await expect(observePodWorkspaces(f.root, { ...f.query, volumes: ['socket'] })).rejects.toThrow('omitted');
    await expect(observePodWorkspaces(f.root, { ...f.query, podUid: '../other' })).rejects.toThrow();
    await expect(observePodWorkspaces(f.root, { ...f.query, volumes: ['../other'] })).rejects.toThrow();
    await symlink('/outside/private', join(f.workspace, 'outside')); const captured = await observePodWorkspaces(f.root, f.query);
    expect(captured.volumes[0]!.files.find(row => row.path === 'outside')?.kind).toBe('symlink');
    await rm(join(f.root, f.podUid), { recursive: true }); await symlink(join(f.root, f.foreign), join(f.root, f.podUid));
    await expect(observePodWorkspaces(f.root, f.query)).rejects.toThrow();
    await rm(join(f.root, f.podUid)); await writeFile(join(f.root, 'unknown-native-material'), 'x');
    await expect(observePodWorkspaces(f.root, f.query)).rejects.toThrow('unsupported original');
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test('the complete kubelet catalog preserves native static Pod hashes without allowing a hash to substitute the selected API Pod', async () => {
  const f = await fixture(), staticUid = 'a'.repeat(32);
  try {
    await mkdir(join(f.root, staticUid));
    expect((await observePodWorkspaces(f.root, f.query)).allPodUids).toEqual([f.podUid, f.foreign, staticUid].sort());
    await expect(observePodWorkspaces(f.root, { ...f.query, podUid: staticUid })).rejects.toThrow();
    await mkdir(join(f.root, 'a'.repeat(31)));
    await expect(observePodWorkspaces(f.root, f.query)).rejects.toThrow('unsupported original');
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
