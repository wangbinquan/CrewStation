import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { observeBuildKitPlatformInputs } from './platformInputs';
import { gitRepositoryIdentity } from './gitInputs';

test('native Git input is selected only by independently retained repository, commit and every original worktree byte', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-git-input-')), directory = 'cache', templateRoot = join(root, 'template');
  const fs = join(root, directory, 'runc-overlayfs/snapshots/snapshots/4/fs'), repository = 'http://original.invalid/group/project.git';
  const git = async (...args: string[]) => {
    const child = Bun.spawn(['git', '-C', fs, ...args], { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
    const [output, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (code) throw Error(error); return output.trim();
  };
  try {
    await mkdir(fs, { recursive: true }); await mkdir(templateRoot); await writeFile(join(templateRoot, 'Dockerfile'), 'FROM scratch\n');
    await git('init', '-q'); await git('config', 'user.name', 'Native input fixture'); await git('config', 'user.email', 'fixture@invalid');
    await git('remote', 'add', 'origin', repository); await writeFile(join(fs, '.gitignore'), 'ignored\n'); await writeFile(join(fs, 'app'), Buffer.from([0, 1, 255]));
    await git('add', '.gitignore', 'app'); await git('commit', '-qm', 'Original input'); const commit = await git('rev-parse', 'HEAD');
    const query = { key: 'original', directory, storageIds: ['4'], gitInputs: [{ repositoryIdentity: gitRepositoryIdentity(repository), commit }] };
    const observe = () => observeBuildKitPlatformInputs({ root, templateRoot }, query);
    expect((await observe()).inputs[0]!.projectMatches).toHaveLength(1);
    expect((await observe()).inputs[0]!.sharedPlatformContentsProven).toBe(false);
    expect(gitRepositoryIdentity('http://user:private@original.invalid/group/project.git')).toBe(query.gitInputs[0]!.repositoryIdentity);
    for (const gitInputs of [[{ ...query.gitInputs[0]!, commit: '0'.repeat(40) }], [{ ...query.gitInputs[0]!, repositoryIdentity: '0'.repeat(64) }]])
      expect((await observeBuildKitPlatformInputs({ root, templateRoot }, { ...query, gitInputs })).inputs[0]!.projectMatches).toEqual([]);
    await writeFile(join(fs, 'ignored'), 'project-private-ignored'); expect((await observe()).inputs[0]!.projectMatches).toEqual([]); await rm(join(fs, 'ignored'));
    await writeFile(join(fs, 'app'), 'changed'); expect((await observe()).inputs[0]!.projectMatches).toEqual([]); await writeFile(join(fs, 'app'), Buffer.from([0, 1, 255]));
    await chmod(join(fs, 'app'), 0o755); expect((await observe()).inputs[0]!.projectMatches).toEqual([]); await chmod(join(fs, 'app'), 0o644);
    expect((await observe()).inputs[0]!.projectMatches).toHaveLength(1);
    expect(await git('status', '--porcelain')).toBe('');
    const tree = (await git('ls-tree', '-r', '--full-tree', commit)).split('\n').map(raw => { const m = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(raw)!; return { mode: m[1] as '100644' | '100755', blob: m[2]!, path: m[3]! }; });
    await rm(join(fs, '.git'), { recursive: true }); expect((await observe()).inputs[0]!.projectMatches).toEqual([]);
    const withoutGit = { ...query, gitInputs: [{ ...query.gitInputs[0]!, tree }] };
    expect((await observeBuildKitPlatformInputs({ root, templateRoot }, withoutGit)).inputs[0]!.projectMatches).toHaveLength(1);
    await writeFile(join(fs, 'private-extra'), 'outside-original-tree');
    expect((await observeBuildKitPlatformInputs({ root, templateRoot }, withoutGit)).inputs[0]!.projectMatches).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
