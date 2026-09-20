import { createHash } from 'node:crypto';
import type { EnvironmentRebuild } from './environmentRebuild';
import type { NativeExecution, TaskEnvironment } from './taskEnvironment';

/** Frozen upgrade provenance is only used when checking an existing Kubernetes object. */
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function nativeIntent(taskId: string, n: NativeExecution): string {
  const extra = n.purpose && n.purpose !== 'cli' ? [n.purpose] : [];
  return digest([taskId, n.parentTaskId, n.pvcUid, n.nodeName, n.runnerId, n.agentId, n.terminalId, n.fingerprint, n.profile, n.image, ...extra]);
}
export function nativeIntentMatches(value: string | undefined, env: TaskEnvironment): boolean {
  return value === nativeIntent(env.id, env.native!) || Boolean(env.legacyCluster?.native && value === nativeIntent(env.legacyCluster.taskId, env.legacyCluster.native));
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
