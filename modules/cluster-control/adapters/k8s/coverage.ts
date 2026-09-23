import type { K8sObject } from '@crewstation/k8s';
import type { ObservedObject } from '../../domain/observation';

/** 期望里的每个字段在观测到的对象里都相同；API Server 补上的缺省字段不算不一致，数组按位置逐个比、长度要相等。 */
export function covers(live: unknown, desired: unknown): boolean {
  if (Array.isArray(desired)) return Array.isArray(live) && live.length === desired.length && desired.every((item, index) => covers(live[index], item));
  if (typeof desired === 'object' && desired !== null) {
    return typeof live === 'object' && live !== null && Object.entries(desired).every(([field, value]) => covers((live as Record<string, unknown>)[field], value));
  }
  return live === desired;
}

/**
 * 观测到的对象已经是期望的样子：标签与 spec 都覆盖期望。期望没有 spec 的（Namespace）只比标签——
 * API Server 给命名空间补的 finalizers 不算不一致。
 */
export function objectCovered(current: ObservedObject | undefined, desired: K8sObject): boolean {
  const spec = (desired as { spec?: unknown }).spec;
  return current !== undefined && covers(current.metadata.labels ?? {}, desired.metadata.labels ?? {}) && (spec === undefined || covers(current.spec, spec));
}
