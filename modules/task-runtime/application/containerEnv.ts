import type { ProjectId } from '@crewstation/contracts';
import { DEVELOPMENT_USAGE_BINDING_DIRECTORY, DEVELOPMENT_USAGE_DIRECTORY, DevelopmentUsageRuntimeConfigSchema, PLATFORM_ENV, RuntimeInitializationMaterialSchema } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { TaskEnvironment } from '../domain/taskEnvironment';
import type { TaskRuntimeUseCaseDeps } from './dependencies';

/** 任务容器的环境：平台约定变量＋所属环境的配置与数据＋任务级数据绑定＋TaskRunner 自身参数。明文令牌只在这里出现一次。 */
export async function containerEnv(deps: Pick<TaskRuntimeUseCaseDeps, 'sources' | 'settings' | 'legacyRunnerTaskId'>, env: TaskEnvironment, svc: { slug: string; name: string }, runnerToken: string): Promise<Record<string, string>> {
  const environment = env.kind === 'dev-session' || env.kind === 'profile-test' ? 'development' : 'production';
  // 档位测试是平台任务：不属于任何项目，不带租户配置、数据或任务级数据绑定（RFC-006 §6）。
  const [config, data, taskData] = env.kind === 'profile-test' ? [{}, {}, {}] : await Promise.all([
    deps.sources.configEnv(env.projectId, environment),
    deps.sources.dataEnv(env.serviceId, environment),
    deps.sources.taskDataEnv(env.native?.parentTaskId ?? env.id),
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
    [PLATFORM_ENV.taskId]: env.native?.parentTaskId ?? env.id,
    [PLATFORM_ENV.traceId]: env.traceId,
    CS_RUNNER_TOKEN: runnerToken,
    CS_CANONICAL_RUNNER_TASK_ID: env.id,
    CS_RUNNER_TASK_ID: await deps.legacyRunnerTaskId?.(env.id) ?? env.id,
    CS_SESSION_URL: deps.settings.sessionUrl,
    ...(env.kind === 'profile-test' ? { CS_RUNNER_BUSINESS_PROBE: '1' } : {}),
    CS_WORKDIR: '/work',
    CS_WORKER_UID: String(deps.settings.workerUid),
    ...(env.render?.businessStorage ? { CS_WORKER_UID: String(env.render.workerUid), CS_WORKER_GID: String(env.render.workerUid) } : {}),
  };
  delete values.CS_RUNNER_DEVELOPMENT_USAGE;
  if (env.render?.developmentUsageStorage) {
    if (env.render.developmentUsageStorage.version !== 1 || env.kind !== 'dev-session' || env.native?.purpose !== 'agent') throw precondition('开发数值日志布局必须绑定独立开发 Agent');
    values.CS_RUNNER_DEVELOPMENT_USAGE = JSON.stringify(DevelopmentUsageRuntimeConfigSchema.parse({ version: 1, directory: DEVELOPMENT_USAGE_DIRECTORY, bindingDirectory: DEVELOPMENT_USAGE_BINDING_DIRECTORY, projectId: env.projectId, workspaceTaskId: env.native.parentTaskId }));
  }
  if (env.native) {
    values.CS_RUNNER_NATIVE_ID = env.native.runnerId;
  }
  if (env.render?.developmentObjectPlanId) {
    if (env.kind !== 'dev-session' || !deps.sources.objectEnv) throw precondition('开发对象空间端口未配置');
    Object.assign(values, await deps.sources.objectEnv(env.serviceId, 'development', env.render.developmentObjectPlanId));
  }
  if (env.render?.objectInputsGeneration && !env.native) {
    if (!deps.sources.taskInputEnv || !env.render.workloadConsumerId) throw precondition('任务输入授权未配置');
    Object.assign(values, await deps.sources.taskInputEnv({ taskId: env.id, generation: env.render.objectInputsGeneration, consumerId: env.render.workloadConsumerId }));
  }
  if (env.preview) {
    values.CS_PREVIEW_COMMAND = JSON.stringify(env.preview.command);
    values.CS_PREVIEW_PORT = String(env.preview.port);
    values.CS_PREVIEW_HEALTH_PATH = env.preview.healthPath;
    values[PLATFORM_ENV.port] = String(env.preview.port);
  }
  const image = env.render?.runtimeImage;
  if (image) {
    for (const key of Object.keys(image.initializer.env)) if (key in values) throw precondition(`运行镜像变量 ${key} 与任务环境冲突`);
    if (image.initializer.secrets.length && !deps.sources.runtimeImageSecrets) throw precondition('初始化 Secret 读取端口尚未配置');
    const secrets = image.initializer.secrets.length ? await deps.sources.runtimeImageSecrets!((env.render?.runtimeValidation?.projectId ?? env.projectId) as ProjectId, { type: env.render?.runtimeValidation ? 'validation' : env.native ? 'agent' : env.kind === 'dev-session' ? 'session' : 'task', id: env.id }, image) : {};
    values.CS_RUNTIME_IMAGE_INITIALIZATION = JSON.stringify(RuntimeInitializationMaterialSchema.parse({
      environmentId: env.id, startGeneration: env.render!.start, versionId: image.versionId, initializerDigest: image.initializerDigest, initializer: image.initializer, tools: image.tools, secrets, ...(env.native || env.render?.runtimeValidation?.usage === 'agent' ? { toolsPhase: 'agent-before-start' } : {}),
    }));
  }
  return values;
}
