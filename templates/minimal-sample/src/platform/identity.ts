/**
 * 网关注入的身份请求头。字面值镜像平台约定表 packages/contracts/convention.ts 的 IDENTITY_HEADERS：
 * 模板是独立项目，不 import 任何工作区包，因此在此抄录一份。业务代码只依赖这些名字，平台改名即破坏性变更。
 */
export const IDENTITY_HEADERS = {
  /** 用户域：网关完成公司登录后注入的已鉴权用户，明文可读。 */
  userId: 'x-cs-user-id',
  userName: 'x-cs-user-name',
  userEmail: 'x-cs-user-email',
  /** 服务域：网关按源 Pod IP 解析出的调用方服务身份（`<project>/<service>`）。 */
  sourceService: 'x-cs-source-service',
  /** 两个域都有：平台 traceId。转发它，本服务发起的业务任务就串进同一条链路。 */
  traceId: 'x-cs-trace-id',
} as const;

/** 从网关请求头读出的当前用户。页面只信任这里的字段：不读 cookie，不解析令牌。 */
export interface GatewayUser {
  id: string;
  name: string;
  email: string | null;
}

/** 没有 `x-cs-user-id` 就是“未识别到网关身份”，例如绕过网关直接访问容器端口或本地运行。 */
export function readGatewayUser(headers: Headers): GatewayUser | null {
  const id = nonEmpty(headers.get(IDENTITY_HEADERS.userId));
  if (!id) return null;
  return {
    id,
    name: nonEmpty(headers.get(IDENTITY_HEADERS.userName)) ?? id,
    email: nonEmpty(headers.get(IDENTITY_HEADERS.userEmail)),
  };
}

export function readSourceService(headers: Headers): string | null {
  return nonEmpty(headers.get(IDENTITY_HEADERS.sourceService));
}

export function readTraceId(headers: Headers): string | null {
  return nonEmpty(headers.get(IDENTITY_HEADERS.traceId));
}

function nonEmpty(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}
