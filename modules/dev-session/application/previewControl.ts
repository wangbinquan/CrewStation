import type { Actor, PreviewAction, PreviewLogsDto, PreviewLogsQuery, PreviewStatusDto, ProjectId } from '@crewstation/contracts';
import { RunnerResultPayloads } from '@crewstation/contracts';
import { newId, notFound, precondition } from '@crewstation/kernel';
import type { EnvironmentView } from '../ports/runtime';
import type { DevSessionUseCaseDeps } from './dependencies';

/**
 * RFC-016：开发会话预览进程的状态、控制与输出。
 *
 * 这里的「预览」是开发容器里按 Manifest 开发命令跑起来的进程，**不是 preview 部署槽**。
 * 预览命令在开会话时固定进容器环境变量，本模块不改它：改了 `crewstation.yaml` 的开发命令
 * 要重建会话才生效（见 RFC-016 非目标）。
 */
export function previewControlUseCases(deps: DevSessionUseCaseDeps) {
  const { environments, runner, authorizer, services, settings } = deps;

  /** 读用 `view`，任何改变运行状态的动作用 `develop`——它改的是同一个容器的运行状态，与开会话同级。 */
  const sessionFor = async (actor: Actor, projectId: ProjectId, action: 'view' | 'develop'): Promise<EnvironmentView> => {
    await authorizer.authorize(actor, projectId, action);
    const env = await environments.findDevSession(projectId);
    if (!env) throw notFound('开发会话', projectId);
    // 断线时不伪装成 stopped：调用方据此重试或重建，而不是以为预览真的停了。
    if (!env.connected) throw precondition('开发容器未连接，无法读取或控制预览进程', { taskId: env.id });
    return env;
  };

  const statusOf = async (env: EnvironmentView): Promise<PreviewStatusDto> => {
    const payload = RunnerResultPayloads.previewStatus.parse(await runner.sendCommand(env.id, { id: newId('cmd'), type: 'previewStatus' }));
    const svc = await services.resolveServiceOfProject(env.projectId);
    if (!svc) throw notFound('项目服务', env.projectId);
    const previewHost = `dev.${svc.slug}.${settings.userDomain}`;
    return {
      taskId: env.id,
      state: payload.state,
      ...(payload.port === undefined ? {} : { port: payload.port }),
      restarts: payload.restarts,
      ...(payload.lastError === undefined ? {} : { lastError: payload.lastError }),
      previewHost,
      // 协议相对：本地集群只有 HTTP，写死 https 会得到一个打不开的链接（与工作台 previewUrl 同源）。
      ...(payload.state === 'ready' ? { url: `//${previewHost}` } : {}),
    };
  };

  return {
    previewStatus: async (actor: Actor, projectId: ProjectId): Promise<PreviewStatusDto> =>
      statusOf(await sessionFor(actor, projectId, 'view')),

    /**
     * 三个动作都回读一次状态再返回，调用方一次拿到结果。
     * `start`／`restart` 只保证命令已受理：`ready` 要等健康探测，所以这里通常仍是 `starting`。
     */
    controlPreview: async (actor: Actor, projectId: ProjectId, action: PreviewAction): Promise<PreviewStatusDto> => {
      const env = await sessionFor(actor, projectId, 'develop');
      const type = action === 'start' ? 'startPreview' : action === 'stop' ? 'stopPreview' : 'restartPreview';
      await runner.sendCommand(env.id, { id: newId('cmd'), type });
      deps.logger.info('dev session preview controlled', { taskId: env.id, projectId, action, by: actor.userId });
      await environments.touch(env.id);
      return statusOf(env);
    },

    previewLogs: async (actor: Actor, projectId: ProjectId, query: PreviewLogsQuery): Promise<PreviewLogsDto> => {
      const env = await sessionFor(actor, projectId, 'view');
      const payload = RunnerResultPayloads.previewLogs.parse(await runner.sendCommand(env.id, {
        id: newId('cmd'), type: 'previewLogs', limit: query.limit, ...(query.stream === undefined ? {} : { stream: query.stream }),
      }));
      return { taskId: env.id, ...payload };
    },
  };
}
