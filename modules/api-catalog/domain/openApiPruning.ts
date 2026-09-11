import { HttpMethodSchema, operationKey } from '@crewstation/contracts';
import type { JsonObject } from './openApiOperations';
import { isJsonObject, openApiPaths } from './openApiOperations';

export interface PruneOptions {
  readonly proxy: string;
  /** 调用方可调的操作键（默认开放 ＋ 已授权）。 */
  readonly allowedKeys: ReadonlySet<string>;
  /** 服务域内部 API 地址：`http://api.<serviceDomain>/api/<proxy>`。 */
  readonly serversUrl: string;
}

/** OpenAPI 的全部方法键；目录之外的方法（trace）永远不可调，裁剪时一并去掉。 */
const METHOD_KEYS = new Set<string>([...HttpMethodSchema.options.map((m) => m.toLowerCase()), 'trace']);
/** 按名字被 security 段引用而不经 $ref 的段落，整体保留。 */
const KEEP_WHOLE_SECTIONS = new Set(['securitySchemes']);
/** OpenAPI 2.0 的根级组件容器（3.x 全部在 components 之下）。 */
const OAS2_CONTAINERS = ['definitions', 'parameters', 'responses'] as const;

/**
 * 服务端裁剪：只保留调用方可调的操作，按 `$ref` 可达性丢弃未被引用的组件，servers 改写为服务域地址。
 * 文档只当作普通 JSON 对象处理，不做 OpenAPI 校验；外部引用原样保留。
 */
export function pruneOpenApi(doc: unknown, options: PruneOptions): JsonObject {
  const paths = prunePaths(openApiPaths(doc), options);
  const source = doc as JsonObject;
  const reached = reachablePointers(source, paths);
  const result: JsonObject = { ...source, paths };
  if (isJsonObject(source.components)) replaceOrDrop(result, 'components', pruneSections(source.components, reached));
  for (const container of OAS2_CONTAINERS) {
    const entries = source[container];
    if (isJsonObject(entries)) replaceOrDrop(result, container, pruneEntries(entries, [container], reached));
  }
  applyServers(result, options.serversUrl);
  return result;
}

function prunePaths(paths: JsonObject, { proxy, allowedKeys }: PruneOptions): JsonObject {
  const out: JsonObject = {};
  for (const [path, item] of Object.entries(paths)) {
    if (!isJsonObject(item)) continue;
    const kept: JsonObject = {};
    let operations = 0;
    for (const [field, value] of Object.entries(item)) {
      if (!METHOD_KEYS.has(field)) {
        kept[field] = value;
      } else if (allowedKeys.has(operationKey(proxy, field, path))) {
        kept[field] = value;
        operations += 1;
      }
    }
    if (operations > 0) out[path] = kept;
  }
  return out;
}

/** 从保留的 paths 出发，沿文档内 `$ref` 做传递闭包；键为规范化后的 JSON Pointer 段。 */
function reachablePointers(source: JsonObject, roots: unknown): Set<string> {
  const reached = new Set<string>();
  const queue: unknown[] = [roots];
  while (queue.length > 0) {
    for (const ref of collectRefs(queue.pop())) {
      const segments = pointerSegments(ref);
      const key = pointerKey(segments);
      if (reached.has(key)) continue;
      const target = resolvePointer(source, segments);
      if (target === undefined) continue;
      reached.add(key);
      queue.push(target);
    }
  }
  return reached;
}

function collectRefs(value: unknown, into: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, into);
    return into;
  }
  if (!isJsonObject(value)) return into;
  for (const [field, child] of Object.entries(value)) {
    if (field === '$ref' && typeof child === 'string' && child.startsWith('#/')) into.push(child);
    else collectRefs(child, into);
  }
  return into;
}

function pointerSegments(ref: string): string[] {
  return ref.slice(2).split('/').map((raw) => {
    let segment = raw;
    try { segment = decodeURIComponent(raw); } catch { /* 非法编码按原文处理 */ }
    return segment.replace(/~1/g, '/').replace(/~0/g, '~');
  });
}

function pointerKey(segments: readonly string[]): string {
  return JSON.stringify(segments);
}

function resolvePointer(source: JsonObject, segments: readonly string[]): unknown {
  let current: unknown = source;
  for (const segment of segments) {
    if (!isJsonObject(current) || !(segment in current)) return undefined;
    current = current[segment];
  }
  return current;
}

function pruneSections(components: JsonObject, reached: Set<string>): JsonObject {
  const out: JsonObject = {};
  for (const [section, entries] of Object.entries(components)) {
    if (KEEP_WHOLE_SECTIONS.has(section)) {
      out[section] = entries;
    } else if (isJsonObject(entries)) {
      const kept = pruneEntries(entries, ['components', section], reached);
      if (Object.keys(kept).length > 0) out[section] = kept;
    }
  }
  return out;
}

function pruneEntries(entries: JsonObject, prefix: readonly string[], reached: Set<string>): JsonObject {
  return Object.fromEntries(Object.entries(entries).filter(([name]) => reached.has(pointerKey([...prefix, name]))));
}

function replaceOrDrop(target: JsonObject, field: string, value: JsonObject): void {
  if (Object.keys(value).length > 0) target[field] = value;
  else delete target[field];
}

/** 3.x 用 servers；2.0 没有 servers，用 schemes／host／basePath 表达同一地址。 */
function applyServers(result: JsonObject, url: string): void {
  if (typeof result.swagger === 'string') {
    const parsed = new URL(url);
    result.schemes = [parsed.protocol.replace(':', '')];
    result.host = parsed.host;
    result.basePath = parsed.pathname.replace(/\/$/, '') || '/';
    delete result.servers;
    return;
  }
  result.servers = [{ url }];
}
