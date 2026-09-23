import type { JsonPatch } from './client';
import { conflict } from '@crewstation/kernel';
import type { K8sClient } from './client';
import type { K8sObject, ResourceRef } from './resources';
import { refOf } from './resources';

export interface FakeK8sClient extends K8sClient {
  readonly objects: Map<string, K8sObject>;
  readonly applied: K8sObject[];
  readonly deleted: string[];
}

const keyOf = (apiVersion: string, kind: string, namespace: string | undefined, name: string): string => `${apiVersion}/${kind}/${namespace ?? ''}/${name}`;

/** 内存版客户端：模块测试用，记录 apply 与 delete 调用；watch 与 logs 不支持。 */
export function createFakeK8sClient(): FakeK8sClient {
  const objects = new Map<string, K8sObject>();
  const applied: K8sObject[] = [];
  const deleted: string[] = [];
  let version = 1;
  const stamp = <T extends K8sObject>(obj: T): T => ({ ...obj, metadata: { ...obj.metadata, resourceVersion: String(version++), uid: obj.metadata.uid ?? `uid-${obj.metadata.name}` } });
  const keyFor = (ref: ResourceRef, name: string, namespace?: string): string => keyOf(ref.apiVersion, ref.kind, ref.namespaced ? namespace : undefined, name);
  const select = (ref: ResourceRef, namespace?: string, labelSelector = '') => {
    const selector = Object.fromEntries(labelSelector.split(',').filter(Boolean).map((pair) => pair.split('=') as [string, string]));
    return [...objects.values()].filter((o) => o.apiVersion === ref.apiVersion && o.kind === ref.kind && (!namespace || o.metadata.namespace === namespace)
      && Object.entries(selector).every(([k, v]) => o.metadata.labels?.[k] === v));
  };
  return {
    nodeMetrics: async () => { throw new Error('Fake kubelet metrics not configured'); },
    objects,
    applied,
    deleted,
    get: async (ref, name, namespace) => objects.get(keyFor(ref, name, namespace)) as never,
    list: async (ref, namespace, options = {}) => select(ref, namespace, options.labelSelector) as never,
    listPage: async (ref, namespace, options = {}) => {
      options.signal?.throwIfAborted();
      const all = select(ref, namespace, options.labelSelector);
      const start = Number(options.continue ?? 0), end = start + (options.limit ?? all.length);
      return { items: all.slice(start, end), resourceVersion: String(version), continue: end < all.length ? String(end) : '' } as never;
    },
    jsonPatch: async (ref, name, namespace, patches) => {
      const key = keyFor(ref, name, namespace), current = objects.get(key);
      if (!current) throw conflict(`${ref.kind} ${name} 不存在`);
      const copy = structuredClone(current);
      for (const patch of patches) applyJsonPatch(copy, patch);
      const stored = stamp(copy); objects.set(key, stored); applied.push(stored); return stored as never;
    },
    create: async (obj) => {
      const key = keyFor(refOf(obj), obj.metadata.name, obj.metadata.namespace);
      if (objects.has(key)) throw conflict(`${obj.kind} ${obj.metadata.name} 已存在`);
      const stored = stamp(obj);
      objects.set(key, stored);
      return stored;
    },
    apply: async (obj, options) => {
      const stored = stamp(obj);
      if (options?.dryRun) return stored;
      objects.set(keyFor(refOf(obj), obj.metadata.name, obj.metadata.namespace), stored);
      applied.push(stored);
      return stored;
    },
    mergePatch: async (ref, name, namespace, patch) => {
      const key = keyFor(ref, name, namespace);
      const current = objects.get(key);
      if (!current) throw conflict(`${ref.kind} ${name} 不存在`);
      const merged = stamp(deepMerge(current, patch as Record<string, unknown>) as K8sObject);
      objects.set(key, merged);
      return merged as never;
    },
    delete: async (ref, name, namespace, options) => {
      const key = keyFor(ref, name, namespace);
      const current = objects.get(key);
      if (current && Object.entries(options?.preconditions ?? {}).some(([field, value]) => value !== undefined && current.metadata[field as 'uid' | 'resourceVersion'] !== value)) {
        throw conflict(`${ref.kind} ${name} 删除前置条件不匹配`);
      }
      deleted.push(key);
      return objects.delete(key);
    },
    watch: async () => { throw new Error('FakeK8sClient 不支持 watch'); },
    logs: async () => new ReadableStream<Uint8Array>({ start: (c) => c.close() }),
  };
}

function deepMerge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else if (typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object' && out[k] !== null && !Array.isArray(out[k])) out[k] = deepMerge(out[k] as Record<string, unknown>, v as Record<string, unknown>);
    else out[k] = v;
  }
  return out;
}

function applyJsonPatch(object: K8sObject, patch: JsonPatch): void {
  const parts = patch.path.slice(1).split('/').map((s) => s.replaceAll('~1', '/').replaceAll('~0', '~'));
  const key = parts.pop()!;
  let parent: Record<string, unknown> = object;
  for (const part of parts) {
    if (!parent[part] || typeof parent[part] !== 'object') throw conflict(`JSON Patch 路径不存在：${patch.path}`);
    parent = parent[part] as Record<string, unknown>;
  }
  if (patch.op === 'test') {
    if (JSON.stringify(parent[key]) !== JSON.stringify(patch.value)) throw conflict(`JSON Patch 前置条件不匹配：${patch.path}`);
  } else if (patch.op === 'remove') delete parent[key];
  else parent[key] = structuredClone(patch.value);
}
