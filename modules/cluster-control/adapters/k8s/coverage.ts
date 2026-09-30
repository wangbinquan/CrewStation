import { isDeepStrictEqual } from 'node:util';
import type { K8sObject } from '@crewstation/k8s';
import type { ObservedObject } from '../../domain/observation';

import { k8sObjectCovers as covers } from '@crewstation/k8s';
export { k8sObjectCovers as covers } from '@crewstation/k8s';

/**
 * spec 整个由平台写、API Server 不补缺省的种类，逐字段相同才算一致。网络策略里的空对象有含义（`podSelector: {}` 全选、
 * 出向规则 `{}` 全放行），按子集比会被任何对象当成已覆盖：线上被改成只选部分 Pod、出向被改窄，都会判「未变」。
 */
const EXACT_SPEC_KINDS: ReadonlySet<string> = new Set(['NetworkPolicy']);

/**
 * 观测到的对象已经是期望的样子：标签与 spec 都覆盖期望，期望带注解的（服务槽的 Deployment 写渲染它的期望版本，T8）注解也要覆盖。
 * 期望没有 spec 的（Namespace）只比标签——API Server 给命名空间补的 finalizers 不算不一致。网络策略的 spec 逐字段比（见上）。
 */
export function objectCovered(current: ObservedObject | undefined, desired: K8sObject): boolean {
  const spec = (desired as { spec?: unknown }).spec;
  if (current === undefined || !covers(current.metadata.labels ?? {}, desired.metadata.labels ?? {})) return false;
  if (desired.metadata.annotations && !covers(current.metadata.annotations ?? {}, desired.metadata.annotations)) return false;
  if (spec === undefined) return true;
  return EXACT_SPEC_KINDS.has(desired.kind) ? isDeepStrictEqual(current.spec, spec) : covers(current.spec, spec);
}
