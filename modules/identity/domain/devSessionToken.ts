import type { ProjectId, ServiceId, TaskId, UserId } from '@crewstation/contracts';
import { ProjectIdSchema, ServiceIdSchema, TOKEN_CLAIMS, TaskIdSchema } from '@crewstation/contracts';
import { userIdFromSubject, userSubject } from './session';

/** 开发会话令牌的 aud：与 session、console、service:* 互不相同，使它无法被当成别的令牌使用。 */
export const DEV_SESSION_AUDIENCE = TOKEN_CLAIMS.audienceDevSession;

/**
 * 4 小时。连接头在 Agent 进程 spawn 时写进 MCP 配置就不再变，所以寿命必须覆盖整个 Agent 进程，
 * 而不只是一轮对话；又要短于 8 小时的浏览器会话，让泄漏的 MCP 配置文件活不过半个工作日。
 * 即时吊销不靠它：每次校验都查这个任务是否仍是运行中的开发会话（§5.9 随会话释放失效），
 * 到期后由下一次 startAgent 重新签发，绝不续期。
 */
export const DEV_SESSION_TOKEN_TTL_SECONDS = 4 * 3600;

/** 一枚开发会话令牌绑死的四件事：哪个会话、哪个项目、哪个服务、代表谁。 */
export interface DevSessionGrant {
  readonly taskId: TaskId;
  readonly projectId: ProjectId;
  readonly serviceId: ServiceId;
  readonly userId: UserId;
}

export function devSessionSubject(userId: UserId): string {
  return userSubject(userId);
}

export function devSessionClaims(grant: DevSessionGrant): Record<string, string> {
  return {
    [TOKEN_CLAIMS.kind]: TOKEN_CLAIMS.kindDevSession,
    [TOKEN_CLAIMS.taskId]: grant.taskId,
    [TOKEN_CLAIMS.project]: grant.projectId,
    [TOKEN_CLAIMS.service]: grant.serviceId,
  };
}

/**
 * 解回授权：任一声明缺失或格式不对就返回 undefined（失败即关门），调用方一律当作令牌无效。
 * 这里只看令牌自身，会话是否还活着由用例层另查。
 */
export function devSessionGrantFrom(subject: string, claims: Record<string, unknown>): DevSessionGrant | undefined {
  if (claims[TOKEN_CLAIMS.kind] !== TOKEN_CLAIMS.kindDevSession) return undefined;
  const userId = userIdFromSubject(subject);
  const taskId = TaskIdSchema.safeParse(claims[TOKEN_CLAIMS.taskId]);
  const projectId = ProjectIdSchema.safeParse(claims[TOKEN_CLAIMS.project]);
  const serviceId = ServiceIdSchema.safeParse(claims[TOKEN_CLAIMS.service]);
  if (!userId || !taskId.success || !projectId.success || !serviceId.success) return undefined;
  return { taskId: taskId.data, projectId: projectId.data, serviceId: serviceId.data, userId };
}
