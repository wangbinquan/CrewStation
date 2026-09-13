import type { ApiInvocationRequest, ApiOperationDto } from '@crewstation/contracts';
import { ApiInvocationInputSchema, ApiInvocationRequestSchema } from '@crewstation/contracts';

export interface ApiInvocationDraft {
  pathParameters: Record<string, string>;
  query: string;
  headers: string;
  body: string;
  includeBody: boolean;
}
export type ApiInvocationDraftErrors = Record<string, string>;

export const apiPathParameterNames = (path: string): string[] => [...new Set([...path.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]!))];
export function emptyApiInvocationDraft(operation: ApiOperationDto): ApiInvocationDraft {
  return { pathParameters: Object.fromEntries(apiPathParameterNames(operation.path).map((name) => [name, ''])), query: '{}', headers: '{}', body: '', includeBody: false };
}

/** 一次返回所有字段错误；JSON 对象和 UTF-8 限制复用请求契约，路径值另检查必填及编码。 */
export function validateApiInvocationDraft(operation: ApiOperationDto, expectedTaskId: string | undefined, draft: ApiInvocationDraft): { input?: ApiInvocationRequest; errors: ApiInvocationDraftErrors } {
  const errors: ApiInvocationDraftErrors = {};
  const query = readJson(draft.query), headers = readJson(draft.headers);
  if (!ApiInvocationInputSchema.shape.query.safeParse(query).success) errors.query = 'catalog.invoke.queryInvalid';
  if (!ApiInvocationInputSchema.shape.headers.safeParse(headers).success) errors.headers = 'catalog.invoke.headersInvalid';
  const body = draft.includeBody ? draft.body : undefined;
  if (!ApiInvocationInputSchema.shape.body.safeParse(body).success || (draft.includeBody && ['GET', 'HEAD'].includes(operation.method))) errors.body = 'catalog.invoke.bodyInvalid';
  for (const name of apiPathParameterNames(operation.path)) {
    const value = draft.pathParameters[name];
    if (!value || value === '.' || value === '..' || value.length > 8192) { errors[`path:${name}`] = 'catalog.invoke.pathInvalid'; continue; }
    try { encodeURIComponent(value); } catch { errors[`path:${name}`] = 'catalog.invoke.pathInvalid'; }
  }
  const parsed = ApiInvocationRequestSchema.safeParse({ expectedTaskId, operationKey: operation.key, pathParameters: draft.pathParameters, query, headers, body });
  if (!expectedTaskId) errors.session = 'catalog.invoke.noSession';
  if (!parsed.success && Object.keys(errors).length === 0) errors.request = 'catalog.invoke.requestInvalid';
  return { errors, ...(parsed.success && Object.keys(errors).length === 0 ? { input: parsed.data } : {}) };
}

function readJson(value: string): unknown {
  try { return JSON.parse(value.trim() || '{}'); } catch { return null; }
}
