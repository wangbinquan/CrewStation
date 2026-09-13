import type { Actor, ApiInvocationRequest, ApiInvocationResponse, ProjectId } from '@crewstation/contracts';
import { ApiInvocationRequestSchema, ApiInvocationResultSchema } from '@crewstation/contracts';
import { isPlatformError, notFound, PlatformError } from '@crewstation/kernel';
import { resolveApiInvocation } from '../domain/apiInvocation';
import type { DevSessionUseCaseDeps } from './dependencies';

/** 当前服务的开发权限、目录授权与固定会话逐项检查后，经该 Pod 的网关发出一次请求。 */
export function apiInvocationUseCase(deps: DevSessionUseCaseDeps) {
  return async (actor: Actor, projectId: ProjectId, request: ApiInvocationRequest): Promise<ApiInvocationResponse> => {
    await deps.authorizer.authorize(actor, projectId, 'develop');
    const parsed = ApiInvocationRequestSchema.safeParse(request);
    if (!parsed.success) throw new PlatformError('validation', '试调输入不合法', { issues: parsed.error.issues });
    const input = parsed.data;
    const env = await deps.environments.findDevSession(projectId);
    if (!env) throw notFound('开发会话', projectId);
    if (env.id !== input.expectedTaskId || env.projectId !== projectId) throw new PlatformError('conflict', '开发会话已变化，请重新检查后试调');
    if (env.state !== 'running' || !env.connected) throw new PlatformError('precondition', '开发容器未运行或未连接，无法试调');
    const service = await deps.services.resolveServiceOfProject(projectId);
    if (!service || service.serviceId !== env.serviceId) throw new PlatformError('conflict', '开发会话的服务身份已变化，无法试调');
    const operations = await deps.apiCatalog.listOperations(actor, service.serviceId);
    const operation = operations.find((item) => item.key === input.operationKey);
    if (!operation) throw new PlatformError('precondition', '操作已不在当前目录，请刷新开发资源');
    if (operation.granted !== true) throw new PlatformError('forbidden', '当前服务尚未获准调用此操作，请先申请');
    const command = resolveApiInvocation(operation, input);
    const current = await deps.environments.findDevSession(projectId);
    if (current?.id !== env.id || current.state !== 'running' || !current.connected || current.serviceId !== env.serviceId) throw new PlatformError('conflict', '开发会话在检查期间已变化，本次未发送请求');
    await deps.environments.touch(env.id);
    const raw = await deps.runner.sendCommand(env.id, { id: `api-${crypto.randomUUID()}`, type: 'invokeApi', ...command }).catch((error: unknown) => {
      if (isPlatformError(error) && typeof error.details.code === 'string' && ['api_invocations_unavailable', 'api_invocation_invalid', 'api_invocation_failed', 'api_invocation_timeout'].includes(error.details.code)) throw error;
      throw new PlatformError('unavailable', '未取得试调结果；请求可能已执行，请先核对业务结果，勿直接重试', { code: isPlatformError(error) ? error.details.code : 'api_invocation_transport_failed' });
    });
    const result = ApiInvocationResultSchema.safeParse(raw);
    if (!result.success) throw new PlatformError('unavailable', '开发容器返回的试调结果无法识别；请求可能已执行，请先核对业务结果，勿直接重试');
    return { taskId: env.id, operationKey: input.operationKey, result: result.data };
  };
}
