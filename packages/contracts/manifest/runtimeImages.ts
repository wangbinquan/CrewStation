import type { z } from 'zod';
import type { RuntimeImageSelection } from '../api/runtimeImages/values';

/** v2 的宽松服务／任务对象不能默默吞掉新字段；保留字段后在版本边界明确拒绝。 */
export function requireRuntimeImageManifestVersion(manifest: {
  apiVersion: string;
  spec: { service: { runtimeImageVersionId?: string }; tasks?: RuntimeImageSelection & { agentProfiles: RuntimeImageSelection[] } };
}, ctx: z.RefinementCtx): void {
  if (manifest.apiVersion === 'crewstation/v3') return;
  const entries: Array<{ value: RuntimeImageSelection; path: PropertyKey[] }> = [{ value: manifest.spec.service, path: ['spec', 'service'] }];
  if (manifest.spec.tasks) {
    entries.push({ value: manifest.spec.tasks, path: ['spec', 'tasks'] });
    manifest.spec.tasks.agentProfiles.forEach((value, index) => entries.push({ value, path: ['spec', 'tasks', 'agentProfiles', index] }));
  }
  for (const { value, path } of entries) for (const field of ['runtimeImageVersionId', 'allowedRuntimeImageVersionIds'] as const) {
    if (field in value) ctx.addIssue({ code: 'custom', path: [...path, field], message: '运行镜像选择需要 apiVersion: crewstation/v3' });
  }
}
