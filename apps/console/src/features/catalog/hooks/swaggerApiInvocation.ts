import type { ApiInvocationRequest, ApiOperationDto } from '@crewstation/contracts';
import { ApiInvocationRequestSchema } from '@crewstation/contracts';
import { apiPathParameterNames } from './apiInvocationDraft';

export interface SwaggerInvocationRequest {
  spec?: Record<string, unknown>;
  pathName?: string;
  method?: string;
  parameters?: Record<string, unknown>;
}
export interface SwaggerBuiltRequest { url?: string; method?: string; headers?: Record<string, unknown>; body?: unknown; form?: unknown }

/** Swagger 自己负责参数序列化；只读取生成结果，执行仍交给固定的目录操作与开发会话。 */
export function swaggerApiInvocation(proxy: string, request: SwaggerInvocationRequest, built: SwaggerBuiltRequest, operations: readonly ApiOperationDto[], expectedTaskId: string | undefined): ApiInvocationRequest {
  const operation = operations.find((item) => item.proxy === proxy && item.path === request.pathName && item.method.toLowerCase() === request.method?.toLowerCase());
  if (!operation || operation.granted !== true) throw new Error('catalog.invoke.operationUnavailable');
  if (!built.url || built.method?.toLowerCase() !== operation.method.toLowerCase()) throw new Error('catalog.invoke.requestInvalid');
  const url = new URL(built.url);
  const server = swaggerServer(request.spec);
  if (url.username || url.password || url.hash || url.origin !== server.origin || server.pathname.replace(/\/$/, '') !== `/api/${proxy}`) throw new Error('catalog.invoke.swaggerDestination');
  const pathParameters = Object.fromEntries(apiPathParameterNames(operation.path).map((name) => {
    const value = request.parameters?.[`path.${name}`] ?? request.parameters?.[name];
    if (!['string', 'number', 'boolean'].includes(typeof value)) throw new Error('catalog.invoke.swaggerUnsupported');
    return [name, String(value)];
  }));
  const expectedPath = `/api/${proxy}${operation.path.replace(/\{([^{}]+)\}/g, (_match, name: string) => encodeURIComponent(pathParameters[name]!))}`;
  // matrix/label 等高级路径序列化不能默默改写为 simple；表单可明确输入其所需路径值。
  if (url.pathname !== expectedPath) throw new Error('catalog.invoke.swaggerUnsupported');
  const query = Object.fromEntries([...new Set(url.searchParams.keys())].map((name) => { const values = url.searchParams.getAll(name); return [name, values.length === 1 ? values[0]! : values]; }));
  const headers = Object.fromEntries(Object.entries(built.headers ?? {}).map(([name, value]) => {
    if (typeof value !== 'string') throw new Error('catalog.invoke.swaggerUnsupported');
    return [name, value];
  }));
  if (built.form !== undefined || (built.body !== undefined && typeof built.body !== 'string')) throw new Error('catalog.invoke.swaggerUnsupported');
  const parsed = ApiInvocationRequestSchema.safeParse({ expectedTaskId, operationKey: operation.key, pathParameters, query, headers, body: built.body });
  if (!parsed.success) throw new Error(expectedTaskId ? 'catalog.invoke.requestInvalid' : 'catalog.invoke.noSession');
  return parsed.data;
}

/** 裁剪文档的根地址来自平台；operation/path 级的其他目的地不能被悄悄替换执行。 */
function swaggerServer(spec: Record<string, unknown> | undefined): URL {
  const entry: unknown = Array.isArray(spec?.servers) ? spec.servers[0] : undefined;
  if (entry && typeof entry === 'object' && 'url' in entry && typeof entry.url === 'string') return new URL(entry.url);
  if (spec?.swagger === '2.0' && typeof spec.host === 'string' && typeof spec.basePath === 'string' && Array.isArray(spec.schemes) && typeof spec.schemes[0] === 'string') return new URL(`${spec.schemes[0]}://${spec.host}${spec.basePath}`);
  throw new Error('catalog.invoke.swaggerDestination');
}
