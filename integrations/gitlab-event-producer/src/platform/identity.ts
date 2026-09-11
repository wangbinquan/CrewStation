/**
 * 网关注入的请求头。字面值镜像平台约定表 packages/contracts/convention.ts 的 IDENTITY_HEADERS。
 * 本接入容器只住在服务域上：没有登录，没有用户身份，只关心链路 traceId。
 */
export const IDENTITY_HEADERS = {
  /** 平台 traceId；有就延续，没有就由 cs-events 生成一个。 */
  traceId: 'x-cs-trace-id',
} as const;

/** 平台 traceId 的形状：32 位十六进制（packages/contracts/ids.ts 的 TraceIdSchema）。 */
const TRACE_ID = /^[0-9a-f]{32}$/;

/** 形状不对的值直接丢弃：带上去只会让 cs-events 整条投递校验失败。 */
export function readTraceId(headers: Headers): string | null {
  const value = headers.get(IDENTITY_HEADERS.traceId)?.trim() ?? '';
  return TRACE_ID.test(value) ? value : null;
}
