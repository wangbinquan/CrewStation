import { PLATFORM_ENV } from '@crewstation/contracts';
import type { TaskEnvironment } from '../domain/taskEnvironment';
import type { TaskRuntimeUseCaseDeps } from './dependencies';

/** 任务容器的环境：平台约定变量＋所属环境的配置与数据＋任务级数据绑定＋TaskRunner 自身参数。明文令牌只在这里出现一次。 */
export async function containerEnv(deps: Pick<TaskRuntimeUseCaseDeps, 'sources' | 'settings'>, env: TaskEnvironment, svc: { slug: string; name: string }, runnerToken: string): Promise<Record<string, string>> {
  const environment = env.kind === 'dev-session' ? 'development' : 'production';
  const [config, data, taskData] = await Promise.all([
    deps.sources.configEnv(env.projectId, environment),
    deps.sources.dataEnv(env.serviceId, environment),
    deps.sources.taskDataEnv(env.id),
  ]);
  const values: Record<string, string> = {
    ...config,
    ...data,
    ...taskData,
    [PLATFORM_ENV.project]: svc.slug,
    [PLATFORM_ENV.service]: svc.name,
    [PLATFORM_ENV.environment]: environment,
    [PLATFORM_ENV.userDomain]: deps.settings.userDomain,
    [PLATFORM_ENV.serviceDomain]: deps.settings.serviceDomain,
    [PLATFORM_ENV.platformApiUrl]: `http://api.${deps.settings.serviceDomain}`,
    [PLATFORM_ENV.internalApiBase]: `http://api.${deps.settings.serviceDomain}/api/`,
    [PLATFORM_ENV.jwksUrl]: `http://api.${deps.settings.serviceDomain}/.well-known/jwks.json`,
    [PLATFORM_ENV.taskId]: env.id,
    [PLATFORM_ENV.traceId]: env.traceId,
    CS_RUNNER_TOKEN: runnerToken,
    CS_SESSION_URL: deps.settings.sessionUrl,
    CS_WORKDIR: '/work',
    CS_WORKER_UID: String(deps.settings.workerUid),
  };
  if (env.preview) {
    values.CS_PREVIEW_COMMAND = JSON.stringify(env.preview.command);
    values.CS_PREVIEW_PORT = String(env.preview.port);
    values.CS_PREVIEW_HEALTH_PATH = env.preview.healthPath;
    values[PLATFORM_ENV.port] = String(env.preview.port);
  }
  if (deps.settings.agentEnvSecretName) values.CS_AGENT_ENV_FILE = '/etc/crewstation/agent.env';
  return values;
}
