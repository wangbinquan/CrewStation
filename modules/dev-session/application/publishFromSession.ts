import type { Actor, ProjectId, PublishRequest, ReleaseDto } from '@crewstation/contracts';
import { notFound, precondition } from '@crewstation/kernel';
import { uncommittedPaths } from '../domain/gitStatus';
import type { DevSessionUseCaseDeps } from './dependencies';

interface ExecResult { exitCode?: number | null; stdout?: string; stderr?: string }

/** 发布入口（R35）：有未提交内容先提示；干净则平台代推当前分支，再交给 release 模块打标签。 */
export function publishFromSessionUseCase(deps: DevSessionUseCaseDeps) {
  const { environments, runner, scm, releases, authorizer, services } = deps;
  const exec = async (taskId: Parameters<typeof runner.sendCommand>[0], command: string[], env: Record<string, string> = {}): Promise<ExecResult> => {
    const execId = `x-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return ((await runner.sendCommand(taskId, { id: execId, type: 'exec', execId, command, timeoutSeconds: 300, env, wait: true })) as ExecResult | null) ?? {};
  };
  return async (actor: Actor, projectId: ProjectId, input: PublishRequest): Promise<ReleaseDto> => {
    await authorizer.authorize(actor, projectId, 'publish');
    const svc = await services.resolveServiceOfProject(projectId);
    if (!svc) throw notFound('项目服务', projectId);
    const env = await environments.findDevSession(projectId);
    if (!env || !env.connected) throw precondition('没有已连接的开发会话，无法检查与推送工作区');
    const status = await exec(env.id, ['git', 'status', '--porcelain']);
    const dirty = uncommittedPaths(status.stdout ?? '');
    if (dirty.length > 0) throw precondition('存在未提交的更改，请先提交', { uncommitted: dirty.slice(0, 50) });
    const { url } = await scm.pushUrl(svc.serviceId);
    const push = await exec(env.id, ['sh', '-c', 'git push "$CS_PUSH_URL" "HEAD:refs/heads/$CS_PUSH_BRANCH"'], { CS_PUSH_URL: url, CS_PUSH_BRANCH: input.branch, GIT_TERMINAL_PROMPT: '0' });
    if ((push.exitCode ?? 1) !== 0) throw precondition(`推送失败，未打标签：${(push.stderr ?? '').split('\n').filter((l) => !l.includes('@')).join(' ').slice(0, 500)}`);
    await environments.touch(env.id);
    return releases.publish(actor, svc.serviceId, input);
  };
}
