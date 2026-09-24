import { createHash } from 'node:crypto';
import type { EnvironmentRebuild } from './environmentRebuild';
import type { NativeExecution, TaskEnvironment } from './taskEnvironment';

/** 执行环境的 Pod 与 Runner Secret 上的受理意图注解与所属工作区标签：清理时照它们认领，对不上就不动（调和器建的也带）。 */
export const EXECUTION_INTENT_ANNOTATION = 'crewstation.io/cli-intent';
export const WORKSPACE_TASK_LABEL = 'crewstation.io/workspace-task';

/** Frozen upgrade provenance is only used when checking an existing Kubernetes object. */
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function intentParts(taskId: string, n: NativeExecution): unknown[] {
  const extra = n.purpose && n.purpose !== 'cli' ? [n.purpose] : [];
  return [taskId, n.parentTaskId, n.pvcUid, n.nodeName, n.runnerId, n.agentId, n.terminalId, n.fingerprint, n.profile, n.image, ...extra];
}
/** 对象的键按字母排序（递归）：摘要不随键的先后变。 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical((value as Record<string, unknown>)[key])]));
}
export function nativeIntent(taskId: string, n: NativeExecution): string {
  return digest(intentParts(taskId, n));
}
/**
 * 与键的先后无关的受理意图（RFC-025 I25 第二步）：资源中心照投影写注解，投影可能用受理时内存里的对象，清理时比对的是库里读回的
 * （jsonb 会重排键，档位对象的键序就变了），两边要算出同一个值。本模块自己建的对象照旧用 nativeIntent，比对时两种都认。
 */
export function canonicalNativeIntent(taskId: string, n: NativeExecution): string {
  return digest(canonical(intentParts(taskId, n)));
}
export function nativeIntentMatches(value: string | undefined, env: TaskEnvironment): boolean {
  if (value === nativeIntent(env.id, env.native!) || value === canonicalNativeIntent(env.id, env.native!)) return true;
  return Boolean(env.legacyCluster?.native && value === nativeIntent(env.legacyCluster.taskId, env.legacyCluster.native));
}
export function taskLabelMatches(value: string | undefined, env: TaskEnvironment): boolean {
  return value === env.id || Boolean(value && value === env.legacyCluster?.taskId);
}
export function rebuildIntent(record: EnvironmentRebuild, legacy = false): string {
  const old = legacy ? record.legacyCluster : undefined;
  return digest({ requestId: old?.rebuildId ?? record.id, taskId: old?.taskId ?? record.taskId, volume: record.input.expectedVolumeUid,
    profile: old?.profile ?? record.input.profile, image: record.image, secret: record.secretName, ...(record.nodeName ? { nodeName: record.nodeName } : {}) });
}
export function rebuildLabelsMatch(taskId: string | undefined, rebuildId: string | undefined, record: EnvironmentRebuild): boolean {
  return (taskId === record.taskId && rebuildId === record.id)
    || Boolean(record.legacyCluster && taskId === record.legacyCluster.taskId && rebuildId === record.legacyCluster.rebuildId);
}
