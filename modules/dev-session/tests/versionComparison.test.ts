import { expect, test } from 'bun:test';
import type { ReleaseId, RunnerCommand, RunnerComparison, SlotDto, TaskId } from '@crewstation/contracts';
import { VersionComparisonDtoSchema } from '@crewstation/contracts';
import { forbidden } from '@crewstation/kernel';
import { versionComparisonUseCases } from '../application/versionComparison';
import { checkedAt, readyWorkspace, workspaceActor, workspaceFixture, workspaceProject, workspaceSha } from './workspaceFixture';

const otherSha = 'f'.repeat(40);
const runnerId = '00000000-0000-4000-8000-000000000001';
const releaseId = '01a0bf5d-8f4b-7fe7-81b4-3ca489d1f621' as ReleaseId;
function fixture() {
  const base = workspaceFixture();
  let slots: SlotDto[] = [{ name: 'prod', active: true, releaseId, tag: 'v0.1.0', commitSha: otherSha, host: 'demo.cs.localhost', replicas: 1, readyReplicas: 1, state: 'ready' }];
  const commands: RunnerCommand[] = [];
  const result: RunnerComparison = { comparisonId: runnerId, targetSha: otherSha, workspace: readyWorkspace(), commits: { status: 'ahead', ahead: 2, behind: 0 }, files: { status: 'ready', count: 1, untrackedCount: 0 }, checkedAt, freshness: 'current' };
  base.deps.releases.getSlots = async () => slots;
  base.deps.runner.sendCommand = async (_task, command) => {
    commands.push(command);
    if (command.type === 'workspaceStatus') return readyWorkspace();
    if (command.type === 'workspaceComparisonDetails') return { comparisonId: runnerId, targetSha: otherSha, tab: command.tab, commits: [], files: [], checkedAt, truncated: false };
    return result;
  };
  return { ...base, commands, result, slots: () => slots, setSlots: (value: SlotDto[]) => { slots = value; }, api: versionComparisonUseCases(base.deps) };
}

test('比较目标取实际生产 releaseId／SHA，工作树保持 Runner 的实际 HEAD', async () => {
  const f = fixture();
  const result = VersionComparisonDtoSchema.parse(await f.api.versionComparison(workspaceActor, workspaceProject));
  expect(result.deployment).toMatchObject({ status: 'ready', releaseId, commitSha: otherSha });
  expect(result.workspace).toMatchObject({ headSha: workspaceSha });
  expect(f.commands).toMatchObject([{ type: 'compareWorkspace', targetSha: otherSha }]);
  const reference = await f.deps.comparisons.get(result.comparisonId!);
  expect(reference).toMatchObject({ runnerComparisonId: runnerId, target: 'prod', deployment: `${releaseId}:${otherSha}` });
});

test('部署查询失败、无部署和 Runner 断线独立表达，不回退为零差距', async () => {
  const f = fixture();
  f.deps.releases.getSlots = async () => { throw new Error('database unavailable'); };
  const unknown = await f.api.versionComparison(workspaceActor, workspaceProject);
  expect(unknown.deployment.status).toBe('unavailable');
  expect(unknown.commits).toMatchObject({ status: 'unavailable' });
  expect(unknown.commits).not.toHaveProperty('ahead');
  expect(f.commands.every((command) => command.type === 'workspaceStatus')).toBe(true);
  f.deps.releases.getSlots = async () => [];
  f.result.commits = { status: 'undeployed' };
  expect((await f.api.versionComparison(workspaceActor, workspaceProject)).deployment.status).toBe('undeployed');
  f.state.connected = false;
  expect((await f.api.versionComparison(workspaceActor, workspaceProject)).workspace.status).toBe('unavailable');
});

test('生产在计算中变化时保留原目标并标 stale，不能把旧数字挂在新 SHA 下', async () => {
  const f = fixture();
  let calls = 0;
  f.deps.releases.getSlots = async () => ++calls === 1 ? f.slots() : [{ ...f.slots()[0]!, commitSha: workspaceSha }];
  const result = await f.api.versionComparison(workspaceActor, workspaceProject);
  expect(result).toMatchObject({ comparisonId: null, freshness: 'stale', deployment: { commitSha: otherSha }, latestDeployment: { commitSha: workspaceSha } });
});

test('旧详情在生产变化或会话替换时拒绝，检查发生在发往 Runner 之前', async () => {
  const f = fixture();
  const result = await f.api.versionComparison(workspaceActor, workspaceProject);
  f.setSlots([{ ...f.slots()[0]!, commitSha: workspaceSha }]);
  await expect(f.api.versionComparisonDetails(workspaceActor, workspaceProject, result.comparisonId!, { tab: 'files', limit: 50 })).rejects.toMatchObject({ kind: 'precondition', details: { code: 'comparison_stale' } });
  expect(f.commands.some((command) => command.type === 'workspaceComparisonDetails')).toBe(false);
  const env = await f.deps.environments.findDevSession(workspaceProject);
  f.deps.environments.findDevSession = async () => ({ ...env!, id: '01a0bf5d-8f4b-7ad2-8eeb-8f56308fb856' as TaskId });
  await expect(f.api.versionComparisonDetails(workspaceActor, workspaceProject, result.comparisonId!, { tab: 'files', limit: 50 })).rejects.toMatchObject({ kind: 'precondition' });
});

test('只读比较不获取凭据；只有 develop 授权后的显式补齐会 fetch', async () => {
  const f = fixture();
  let issued = 0;
  f.deps.scm.pushUrl = async () => { issued++; return { url: 'https://git.example/repo.git', expiresAt: checkedAt }; };
  await f.api.versionComparison(workspaceActor, workspaceProject);
  expect(issued).toBe(0);
  f.deps.authorizer.authorize = async (_actor, _project, action) => { if (action === 'develop') throw forbidden('无开发权限'); };
  await expect(f.api.refreshComparisonHistory(workspaceActor, workspaceProject)).rejects.toMatchObject({ kind: 'forbidden' });
  expect(issued).toBe(0);
  f.deps.authorizer.authorize = async () => {};
  await f.api.refreshComparisonHistory(workspaceActor, workspaceProject);
  expect(issued).toBe(1);
  expect(f.commands.find((command) => command.type === 'fetchComparisonHistory')).toMatchObject({ targetSha: otherSha });
});
