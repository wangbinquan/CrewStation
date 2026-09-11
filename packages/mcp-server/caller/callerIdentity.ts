import { IDENTITY_HEADERS } from '@crewstation/contracts';
import { unauthenticated } from '@crewstation/kernel';

/** MCP 的调用方永远是一个任务容器（开发会话或业务任务），由网关按源 Pod IP 反查后注入。 */
export interface McpCaller {
  /** `<project>/<service>` */
  readonly identity: string;
  readonly project: string;
  readonly service: string;
  readonly slot?: string;
  readonly sourceToken?: string;
  /** 开发会话令牌：由平台注入 Agent 的 MCP 连接头，Agent 自带过来，MCP 原样转给 cs-api 验签。 */
  readonly devSessionToken?: string;
  readonly traceId?: string;
  readonly requestId?: string;
}

/** 只认网关注入的头：MCP 直连时这些头不存在，调用会被干净地拒绝，而不是被当成匿名放行。 */
export function callerFromHeaders(headers: Headers): McpCaller | undefined {
  const identity = headers.get(IDENTITY_HEADERS.sourceService);
  if (!identity) return undefined;
  const [project = '', service = ''] = identity.split('/');
  if (!project || !service) return undefined;
  const slot = headers.get(IDENTITY_HEADERS.sourceSlot);
  const sourceToken = headers.get(IDENTITY_HEADERS.sourceToken);
  const devSessionToken = headers.get(IDENTITY_HEADERS.devSessionToken);
  const traceId = headers.get(IDENTITY_HEADERS.traceId);
  const requestId = headers.get(IDENTITY_HEADERS.requestId);
  return {
    identity,
    project,
    service,
    ...(slot ? { slot } : {}),
    ...(sourceToken ? { sourceToken } : {}),
    ...(devSessionToken ? { devSessionToken } : {}),
    ...(traceId ? { traceId } : {}),
    ...(requestId ? { requestId } : {}),
  };
}

export function requireCaller(caller: McpCaller | undefined): McpCaller {
  if (!caller) {
    throw unauthenticated(
      `网关未注入调用方服务身份（${IDENTITY_HEADERS.sourceService}）：本 MCP 只在服务域上提供服务，请用平台注入容器的 MCP 地址连接`,
    );
  }
  return caller;
}

/**
 * 出站调用透传调用方身份：MCP 自身只是转发者，授权由 cs-api 与网关按这份身份判定，
 * MCP 不得凭自己的平台身份替调用方决定任何事。
 * 这份不含开发会话令牌：它经网关发往公司上游，凭据不能顺着流出去。
 */
export function callerForwardHeaders(caller: McpCaller): Record<string, string> {
  return {
    [IDENTITY_HEADERS.sourceService]: caller.identity,
    ...(caller.slot ? { [IDENTITY_HEADERS.sourceSlot]: caller.slot } : {}),
    ...(caller.sourceToken ? { [IDENTITY_HEADERS.sourceToken]: caller.sourceToken } : {}),
    ...(caller.traceId ? { [IDENTITY_HEADERS.traceId]: caller.traceId } : {}),
    ...(caller.requestId ? { [IDENTITY_HEADERS.requestId]: caller.requestId } : {}),
  };
}

/**
 * 调 cs-api 时在上面再加开发会话令牌：平台 API 的用户面路由只认用户身份，
 * 而这枚令牌是 Agent 唯一能出示的用户凭据（Design §5.9），cs-api 验签后据它判定本次调用。
 */
export function platformCallHeaders(caller: McpCaller): Record<string, string> {
  return {
    ...callerForwardHeaders(caller),
    ...(caller.devSessionToken ? { [IDENTITY_HEADERS.devSessionToken]: caller.devSessionToken } : {}),
  };
}
