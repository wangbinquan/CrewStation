import type { Actor, ProjectId, PublishDevSessionRequest, ReleaseDto } from '@crewstation/contracts';
import { RunnerResultPayloads } from '@crewstation/contracts';
import { notFound, precondition } from '@crewstation/kernel';
import type { DevSessionUseCaseDeps } from './dependencies';
import { inspectWorkspace } from './workspaceStatus';

interface ExecResult { exitCode?: number | null; stdout?: string; stderr?: string }

/** 发布入口（R35）：有未提交内容先提示；干净则平台代推当前分支，再交给 release 模块打标签。 */
export function publishFromSessionUseCase(deps: DevSessionUseCaseDeps) {
  const { environments, runner, scm, releases, authorizer, services } = deps;
  const exec = async (taskId: Parameters<typeof runner.sendCommand>[0], command: string[], env: Record<string, string> = {}): Promise<ExecResult> => {
    const execId = `x-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return RunnerResultPayloads.exec.parse(await runner.sendCommand(taskId, { id: execId, type: 'exec', execId, command, timeoutSeconds: 300, env, wait: true }));
  };
  return async (actor: Actor, projectId: ProjectId, input: PublishDevSessionRequest): Promise<ReleaseDto> => {
    await authorizer.authorize(actor, projectId, 'publish');
    const svc = await services.resolveServiceOfProject(projectId);
    if (!svc) throw notFound('项目服务', projectId);
    const env = await environments.findDevSession(projectId);
    if (!env || !env.connected) throw precondition('没有已连接的开发会话，无法检查与推送工作区');
    const { expectedTaskId, ...releaseInput } = input;
    if (expectedTaskId && env.id !== expectedTaskId) throw precondition('开发会话已经变化，请重新确认发布来源', { expected: expectedTaskId, actual: env.id });
    const status = await inspectWorkspace(deps, env);
    if (status.status === 'unavailable') throw precondition(`无法检查工作区，未推送或打标签：${status.reason}`);
    if (status.uncommittedCount > 0) throw precondition('存在未提交的更改，请先提交', { uncommitted: status.uncommitted.slice(0, 50).map((file) => file.path), total: status.uncommittedCount });
    if (!status.headSha) throw precondition('工作树还没有首次提交，请先提交');
    if (input.expectedCommitSha && status.headSha !== input.expectedCommitSha) throw precondition('工作树 HEAD 已经变化，请重新确认发布来源', { expected: input.expectedCommitSha, actual: status.headSha });
    if (status.branch !== null && status.branch !== input.branch) throw precondition('当前工作树分支已经变化，请重新确认发布来源', { branch: status.branch, headSha: status.headSha });
    const { url } = await scm.pushUrl(svc.serviceId);
    const push = await exec(env.id, ['sh', '-c', 'git push "$CS_PUSH_URL" "$CS_PUSH_SHA:refs/heads/$CS_PUSH_BRANCH"'], { CS_PUSH_URL: url, CS_PUSH_SHA: status.headSha, CS_PUSH_BRANCH: input.branch, GIT_TERMINAL_PROMPT: '0' });
    if ((push.exitCode ?? 1) !== 0) throw precondition(`推送失败，未打标签：${(push.stderr ?? '').split('\n').filter((l) => !l.includes('@')).join(' ').slice(0, 500)}`);
    await environments.touch(env.id);
    return releases.publish(actor, svc.serviceId, { ...releaseInput, expectedCommitSha: status.headSha });
  };
}
