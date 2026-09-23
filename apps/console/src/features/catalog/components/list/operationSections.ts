import type { ApiOperationDto, ApiRequestDto } from '@crewstation/contracts';
import { PLATFORM_ENV } from '@crewstation/contracts';

/** 平台自己的接口（业务子任务），业务以本服务身份直接调，总是可调。 */
export interface PlatformEndpoint { readonly method: string; readonly path: string; readonly summary: string }

/** 列表里一条接口在本服务眼里的状态：可调、审批中、可申请、未放行（默认开放却未授权，罕见）。 */
export type OperationStatus = 'callable' | 'pending' | 'requestable' | 'blocked';
export type StatusFilter = 'all' | 'callable' | 'request';
/** 提供方筛选：空串是全部，`platform` 是平台接口，其余是代理 ID。 */
export const ALL_PROVIDERS = '', PLATFORM_PROVIDER = 'platform';
export interface OperationListFilter { readonly text: string; readonly provider: string; readonly status: StatusFilter }
export const INITIAL_OPERATION_FILTER: OperationListFilter = { text: '', provider: ALL_PROVIDERS, status: 'all' };

export function operationStatus(operation: ApiOperationDto, pending: ReadonlyMap<string, ApiRequestDto>): OperationStatus {
  if (operation.granted === true) return 'callable';
  if (pending.has(operation.id)) return 'pending';
  return operation.openPolicy === 'targeted' ? 'requestable' : 'blocked';
}

/** 代码里真正写的地址：`CS_INTERNAL_API_BASE` 以 `/api/` 结尾，后接 `<代理>/<上游路径>`。 */
export function internalCallUrl(operation: Pick<ApiOperationDto, 'proxy' | 'path'>): string {
  return `\${${PLATFORM_ENV.internalApiBase}}${operation.proxy}${operation.path.startsWith('/') ? operation.path : `/${operation.path}`}`;
}

export function platformCallUrl(endpoint: PlatformEndpoint): string {
  return `\${${PLATFORM_ENV.platformApiUrl}}${endpoint.path}`;
}

/** 只有 pending 会挡住再次申请；已批准或已拒绝的申请不影响再次提交。 */
export function indexPending(requests: readonly ApiRequestDto[]): ReadonlyMap<string, ApiRequestDto> {
  const map = new Map<string, ApiRequestDto>();
  for (const request of requests) if (request.state === 'pending') map.set(request.operationId, request);
  return map;
}

function matchesText(text: string, ...values: readonly (string | undefined)[]): boolean {
  const needle = text.trim().toLowerCase();
  return needle === '' || values.some((value) => value?.toLowerCase().includes(needle));
}

export interface OperationSections {
  readonly callable: readonly ApiOperationDto[];
  readonly platform: readonly PlatformEndpoint[];
  /** 需申请、审批中与未放行，可申请的在前。 */
  readonly other: readonly ApiOperationDto[];
}

const byProviderAndPath = (a: ApiOperationDto, b: ApiOperationDto) => a.proxy.localeCompare(b.proxy) || a.path.localeCompare(b.path) || a.method.localeCompare(b.method);
const OTHER_ORDER: Record<OperationStatus, number> = { callable: 0, requestable: 1, pending: 2, blocked: 3 };

/** 可调用的置顶，其余在分割线下；筛选只作用于已取回的列表，不改变请求。 */
export function sectionOperations(operations: readonly ApiOperationDto[], platform: readonly PlatformEndpoint[], pending: ReadonlyMap<string, ApiRequestDto>, filter: OperationListFilter): OperationSections {
  const shown = operations.filter((item) => (filter.provider === ALL_PROVIDERS || filter.provider === item.proxyId) && matchesText(filter.text, item.method, item.path, item.proxy, item.summary));
  const callable = shown.filter((item) => operationStatus(item, pending) === 'callable').sort(byProviderAndPath);
  const other = shown.filter((item) => operationStatus(item, pending) !== 'callable')
    .sort((a, b) => OTHER_ORDER[operationStatus(a, pending)] - OTHER_ORDER[operationStatus(b, pending)] || byProviderAndPath(a, b));
  const platformShown = filter.provider === ALL_PROVIDERS || filter.provider === PLATFORM_PROVIDER
    ? platform.filter((item) => matchesText(filter.text, item.method, item.path, item.summary)) : [];
  return {
    callable: filter.status === 'request' ? [] : callable,
    platform: filter.status === 'request' ? [] : platformShown,
    other: filter.status === 'callable' ? [] : other,
  };
}
