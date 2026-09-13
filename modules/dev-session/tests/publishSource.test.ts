import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PublishRequest, TaskId } from '@crewstation/contracts';
import { publishFromSessionUseCase } from '../application/publishFromSession';
import { readyWorkspace, workspaceActor, workspaceFixture, workspaceProject, workspaceSha, workspaceTask } from './workspaceFixture';

test('确认后会话或 HEAD 已变化：不推送、不打标签，旧来源不能应用到新会话', async () => {
  const { deps, state, commands } = workspaceFixture();
  const publish = publishFromSessionUseCase(deps);
  // 原入口只看请求抵达时的会话与分支，会发布用户尚未确认的同分支新 HEAD。
  await expect(publish(workspaceActor, workspaceProject, { branch: 'main', version: 'patch', expectedCommitSha: 'a'.repeat(40) })).rejects.toMatchObject({ kind: 'precondition', details: { actual: workspaceSha } });
  commands.length = 0;
  await expect(publish(workspaceActor, workspaceProject, { branch: 'main', version: 'patch', expectedTaskId: `tsk_${'f'.repeat(32)}` as TaskId })).rejects.toMatchObject({ kind: 'precondition' });
  expect(commands).toHaveLength(0);
  expect(state.published).toBe(false);
});

test('检查后 HEAD 前进时只推送已确认 SHA，release 收到同一 SHA；兼容旧调用方也冻结检查结果', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cs-publish-source-'));
  const work = join(root, 'work'), remote = join(root, 'remote.git');
  const git = async (args: string[], cwd = work) => {
    const process = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr, code] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
    if (code !== 0) throw new Error(stderr); return stdout.trim();
  };
  try {
    await git(['init', '-q', '-b', 'main', work], root); await git(['init', '-q', '--bare', remote], root);
    await writeFile(join(work, 'draft.txt'), 'confirmed\n'); await git(['add', 'draft.txt']);
    await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'confirmed']);
    const confirmed = await git(['rev-parse', 'HEAD']);
    const { deps, state } = workspaceFixture(); let published: PublishRequest | undefined;
    state.result = { ...readyWorkspace(), headSha: confirmed };
    deps.scm.pushUrl = async () => {
      await writeFile(join(work, 'draft.txt'), 'later agent commit\n');
      await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qam', 'later']);
      return { url: remote, expiresAt: '2026-09-13T01:00:00.000Z' };
    };
    deps.runner.sendCommand = async (_task, command) => {
      if (command.type !== 'exec') return state.result;
      const process = Bun.spawn(command.command, { cwd: work, env: { ...Bun.env, ...command.env }, stdout: 'pipe', stderr: 'pipe' });
      const [stdout, stderr, exitCode] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
      return { execId: command.execId, stdout, stderr, exitCode, durationMs: 1, truncated: false };
    };
    const release = deps.releases.publish;
    deps.releases.publish = async (actor, service, input) => { published = input; return release(actor, service, input); };
    await publishFromSessionUseCase(deps)(workspaceActor, workspaceProject, { branch: 'main', version: 'patch', expectedTaskId: workspaceTask });
    // 执行真实 git push；原实现使用 HEAD，会把后来 Agent 的提交一起推上去。
    expect(await git(['rev-parse', 'refs/heads/main'], remote)).toBe(confirmed);
    expect(await git(['rev-parse', 'HEAD'])).not.toBe(confirmed);
    expect(published).toMatchObject({ branch: 'main', expectedCommitSha: confirmed });
    expect(published).not.toHaveProperty('expectedTaskId');
  } finally { await rm(root, { recursive: true, force: true }); }
}, 20_000);
