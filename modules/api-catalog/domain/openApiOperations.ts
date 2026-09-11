import type { HttpMethod } from '@crewstation/contracts';
import { HttpMethodSchema } from '@crewstation/contracts';
import { validation } from '@crewstation/kernel';
import type { DiscoveredOperation } from './apiOperation';

export type JsonObject = Record<string, unknown>;

const METHODS: readonly HttpMethod[] = HttpMethodSchema.options;
/** 代理作者在 OpenAPI 操作上用此扩展字段标注资源语义。 */
const RESOURCE_NOTE_EXTENSION = 'x-cs-resource-note';

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 文档必须是带 paths 的对象；否则视为发布内容错误而不是空目录——空目录会让所有已授权调用方一起失配。 */
export function openApiPaths(doc: unknown): JsonObject {
  if (!isJsonObject(doc) || !isJsonObject(doc.paths)) throw validation('OpenAPI 文档必须是带 paths 的对象');
  return doc.paths;
}

/** paths × HTTP 方法 → 操作；summary 取 operation.summary，资源说明取 x-cs-resource-note。目录外的方法（trace 等）忽略。 */
export function operationsFromOpenApi(doc: unknown): DiscoveredOperation[] {
  const out: DiscoveredOperation[] = [];
  for (const [path, item] of Object.entries(openApiPaths(doc))) {
    if (!isJsonObject(item) || !path.startsWith('/')) continue;
    for (const method of METHODS) {
      const operation = item[method.toLowerCase()];
      if (!isJsonObject(operation)) continue;
      const note = operation[RESOURCE_NOTE_EXTENSION];
      out.push({
        method,
        path,
        ...(typeof operation.summary === 'string' ? { summary: operation.summary } : {}),
        ...(typeof note === 'string' ? { resourceNote: note } : {}),
      });
    }
  }
  return out;
}
