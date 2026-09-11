import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertRefName, bunGitRunner } from './bunGitRunner';

const runner = bunGitRunner({ authorName: 'CrewStation Bot', authorEmail: 'bot@crewstation.local' });
let root: string;
let remote: string;
let workdir: string;

const git = async (cwd: string, ...args: string[]): Promise<string> => {
  const proc = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  if (code !== 0) throw new Error(`git ${args.join(' ')} failed: ${await new Response(proc.stderr).text()}`);
  return out.trim();
};

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'cs-git-runner-'));
  remote = join(root, 'remote.git');
  workdir = join(root, 'work');
  await git(root, 'init', '-q', '--bare', remote);
  await Bun.write(join(workdir, 'README.md'), '# demo\n');
  await Bun.write(join(workdir, 'src', 'index.ts'), 'export {};\n');
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

describe('bunGitRunner', () => {
  test('initAndPush：初始化、提交全部文件并推送到指定分支；作者是平台机器人', async () => {
    const { commitSha } = await runner.initAndPush({ workdir, remoteUrlWithCredential: `file://${remote}`, branch: 'main', message: 'chore: init' });
    expect(commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(await git(remote, 'rev-parse', 'refs/heads/main')).toBe(commitSha);
    expect(await git(remote, 'log', '-1', '--format=%an <%ae>%n%s', 'main')).toBe('CrewStation Bot <bot@crewstation.local>\nchore: init');
    expect((await git(remote, 'ls-tree', '-r', '--name-only', 'main')).split('\n').sort()).toEqual(['README.md', 'src/index.ts']);
    expect(await runner.headSha(workdir, 'main')).toBe(commitSha);
  });

  test('pushBranch 推送本地新提交；不存在的分支报错', async () => {
    await writeFile(join(workdir, 'CHANGES.md'), 'second\n');
    await git(workdir, 'add', '-A');
    await git(workdir, 'commit', '-q', '-m', 'second');
    const { commitSha } = await runner.pushBranch({ workdir, remoteUrlWithCredential: `file://${remote}`, branch: 'main' });
    expect(await git(remote, 'rev-parse', 'refs/heads/main')).toBe(commitSha);
    await expect(runner.headSha(workdir, 'nope')).rejects.toMatchObject({ kind: 'unavailable' });
  });

  test('推送失败时错误消息不含凭据，命令行上的地址也不含凭据', async () => {
    const secret = 'glpat-super-secret-value';
    try {
      await runner.pushBranch({ workdir, remoteUrlWithCredential: `http://crewstation:${secret}@127.0.0.1:9/nowhere/repo.git`, branch: 'main' });
      throw new Error('should fail');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('git push 失败');
      expect(message).not.toContain(secret);
      expect(JSON.stringify((error as { details?: unknown }).details ?? {})).not.toContain(secret);
    }
  });

  test('引用名白名单拒绝以 - 开头、含 .. 或以 .lock 结尾的名字', () => {
    for (const ok of ['main', 'feature/x-1', 'release.2026']) expect(() => assertRefName(ok)).not.toThrow();
    for (const bad of ['-f', 'a..b', 'x.lock', 'a//b', 'a/', '.hidden', 'a\\b', 'a@{1}']) expect(() => assertRefName(bad)).toThrow(expect.objectContaining({ kind: 'validation' }));
  });
});
