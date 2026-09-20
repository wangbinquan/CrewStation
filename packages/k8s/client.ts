import { PlatformError, conflict, forbidden, validation } from '@crewstation/kernel';
import type { ClusterConfig } from './config';
import type { K8sObject, ResourceRef, WatchEventType } from './resources';
import { refOf, resourcePath } from './resources';
import { readWatchStream } from './watch';

export interface ListOptions { labelSelector?: string; fieldSelector?: string; limit?: number; continue?: string; signal?: AbortSignal }
export interface ListPage<T> { items: T[]; resourceVersion: string; continue: string }
export interface JsonPatch { op: 'test' | 'add' | 'replace' | 'remove'; path: string; value?: unknown }
export interface DeleteOptions {
  propagationPolicy?: 'Background' | 'Foreground' | 'Orphan';
  gracePeriodSeconds?: number;
  /** API Server 原子确认实例，避免删除同名但已经替换的对象。 */
  preconditions?: { uid?: string; resourceVersion?: string };
}
export interface WatchOptions { labelSelector?: string; resourceVersion?: string; timeoutSeconds?: number; signal?: AbortSignal }
export interface LogOptions { container?: string; follow?: boolean; previous?: boolean; timestamps?: boolean; sinceSeconds?: number; tailLines?: number; signal?: AbortSignal }

/** 平台只需要的 API Server 操作；模块通过它而不是 kubectl 管理对象。 */
export interface K8sClient {
  get<T extends K8sObject>(ref: ResourceRef, name: string, namespace?: string, signal?: AbortSignal): Promise<T | undefined>;
  list<T extends K8sObject>(ref: ResourceRef, namespace?: string, options?: ListOptions): Promise<T[]>;
  listPage<T extends K8sObject>(ref: ResourceRef, namespace?: string, options?: ListOptions): Promise<ListPage<T>>;
  jsonPatch<T extends K8sObject>(ref: ResourceRef, name: string, namespace: string | undefined, patch: JsonPatch[]): Promise<T>;
  create<T extends K8sObject>(obj: T): Promise<T>;
  /** 服务端 apply：幂等写入，由 fieldManager 拥有字段。 */
  apply<T extends K8sObject>(obj: T, options?: { fieldManager?: string; force?: boolean }): Promise<T>;
  mergePatch<T extends K8sObject>(ref: ResourceRef, name: string, namespace: string | undefined, patch: unknown): Promise<T>;
  /** 不存在时返回 false，不抛错。 */
  delete(ref: ResourceRef, name: string, namespace?: string, options?: DeleteOptions): Promise<boolean>;
  watch<T extends K8sObject>(ref: ResourceRef, namespace: string | undefined, options: WatchOptions, onEvent: (type: WatchEventType, obj: T) => void): Promise<void>;
  logs(namespace: string, pod: string, options?: LogOptions): Promise<ReadableStream<Uint8Array>>;
}

export function createK8sClient(config: ClusterConfig, fetchImpl: typeof fetch = fetch): K8sClient {
  const request = async (method: string, path: string, init: { body?: string; contentType?: string; signal?: AbortSignal } = {}): Promise<Response> => {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (config.token) headers.authorization = `Bearer ${config.token}`;
    if (init.contentType) headers['content-type'] = init.contentType;
    const tls: Record<string, unknown> = {};
    if (config.ca) tls.ca = config.ca;
    if (config.clientCert) tls.cert = config.clientCert;
    if (config.clientKey) tls.key = config.clientKey;
    if (config.insecureSkipTlsVerify) tls.rejectUnauthorized = false;
    const requestInit = { method, headers, ...(init.body === undefined ? {} : { body: init.body }), ...(init.signal ? { signal: init.signal } : {}), tls } as RequestInit;
    return fetchImpl(`${config.server}${path}`, requestInit);
  };

  const json = async <T>(res: Response): Promise<T> => {
    if (res.ok) return (await res.json()) as T;
    throw await toError(res);
  };

  const listPage = async <T extends K8sObject>(ref: ResourceRef, namespace?: string, options: ListOptions = {}): Promise<ListPage<T>> => {
    const body = await json<{ items: T[]; metadata?: { resourceVersion?: string; continue?: string } }>(await request('GET', `${resourcePath(ref, namespace)}?${listQuery(options)}`, options.signal ? { signal: options.signal } : {}));
    return { items: body.items.map((item) => ({ ...item, apiVersion: item.apiVersion ?? ref.apiVersion, kind: item.kind ?? ref.kind })), resourceVersion: body.metadata?.resourceVersion ?? '', continue: body.metadata?.continue ?? '' };
  };
  return {
    get: async (ref, name, namespace, signal) => {
      const res = await request('GET', resourcePath(ref, namespace, name), signal ? { signal } : {});
      if (res.status === 404) return undefined;
      return json(res);
    },
    list: async (ref, namespace, options) => (await listPage(ref, namespace, options)).items as never,
    listPage,
    jsonPatch: async (ref, name, namespace, patch) => json(await request('PATCH', resourcePath(ref, namespace, name), { body: JSON.stringify(patch), contentType: 'application/json-patch+json', signal: AbortSignal.timeout(15_000) })),
    create: async (obj) => json(await request('POST', resourcePath(refOf(obj), obj.metadata.namespace), { body: JSON.stringify(obj), contentType: 'application/json' })),
    apply: async (obj, options = {}) => {
      const params = new URLSearchParams({ fieldManager: options.fieldManager ?? 'crewstation', force: String(options.force ?? true) });
      return json(await request('PATCH', `${resourcePath(refOf(obj), obj.metadata.namespace, obj.metadata.name)}?${params}`, { body: JSON.stringify(obj), contentType: 'application/apply-patch+yaml' }));
    },
    mergePatch: async (ref, name, namespace, patch) => json(await request('PATCH', resourcePath(ref, namespace, name), { body: JSON.stringify(patch), contentType: 'application/merge-patch+json' })),
    delete: async (ref, name, namespace, options = {}) => {
      const res = await request('DELETE', resourcePath(ref, namespace, name), { body: JSON.stringify({ apiVersion: 'v1', kind: 'DeleteOptions', ...options }), contentType: 'application/json', signal: AbortSignal.timeout(15_000) });
      if (res.status === 404) return false;
      if (!res.ok) throw await toError(res);
      return true;
    },
    watch: async (ref, namespace, options, onEvent) => {
      const params = new URLSearchParams({ watch: '1', allowWatchBookmarks: 'true', timeoutSeconds: String(options.timeoutSeconds ?? 300) });
      if (options.labelSelector) params.set('labelSelector', options.labelSelector);
      if (options.resourceVersion) params.set('resourceVersion', options.resourceVersion);
      const res = await request('GET', `${resourcePath(ref, namespace)}?${params}`, options.signal ? { signal: options.signal } : {});
      if (!res.ok) throw await toError(res);
      await readWatchStream(res, onEvent);
    },
    logs: async (namespace, pod, options = {}) => {
      const params = new URLSearchParams();
      if (options.container) params.set('container', options.container);
      if (options.follow) params.set('follow', 'true');
      if (options.previous) params.set('previous', 'true');
      if (options.timestamps !== undefined) params.set('timestamps', String(options.timestamps));
      if (options.sinceSeconds) params.set('sinceSeconds', String(options.sinceSeconds));
      if (options.tailLines !== undefined) params.set('tailLines', String(options.tailLines));
      const res = await request('GET', `/api/v1/namespaces/${namespace}/pods/${pod}/log?${params}`, options.signal ? { signal: options.signal } : {});
      if (!res.ok) throw await toError(res);
      return res.body ?? new ReadableStream<Uint8Array>({ start: (c) => c.close() });
    },
  };
}

function listQuery(options: ListOptions): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of ['labelSelector', 'fieldSelector', 'limit', 'continue'] as const) if (options[key] !== undefined) params.set(key, String(options[key]));
  return params;
}

async function toError(res: Response): Promise<PlatformError> {
  let message = `${res.status} ${res.statusText}`;
  try {
    const body = (await res.json()) as { message?: string };
    if (body.message) message = body.message;
  } catch { /* 无 JSON 正文 */ }
  switch (res.status) {
    case 401: case 403: return forbidden(`Kubernetes 拒绝：${message}`);
    case 409: return conflict(`Kubernetes 冲突：${message}`);
    case 422: return validation(`Kubernetes 校验失败：${message}`);
    case 404: return new PlatformError('not_found', message);
    default: return new PlatformError('unavailable', `Kubernetes 错误：${message}`, { status: res.status });
  }
}
