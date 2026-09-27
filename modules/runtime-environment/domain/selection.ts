import type { RuntimeImageSelection } from '@crewstation/contracts';
import { validation } from '@crewstation/kernel';

/** 只看当前位置的集合：父任务、其他 Agent 或服务的选择不参与解析。 */
export function selectRuntimeImage(requested: string | undefined, selection: RuntimeImageSelection): { versionId: string; source: 'request' | 'configuration' } | undefined {
  if (requested !== undefined) {
    if (requested !== selection.runtimeImageVersionId && !selection.allowedRuntimeImageVersionIds?.includes(requested)) {
      throw validation('指定镜像不在此执行位置的允许集合内', { code: 'runtime_image_not_allowed', versionId: requested });
    }
    return { versionId: requested, source: 'request' };
  }
  return selection.runtimeImageVersionId ? { versionId: selection.runtimeImageVersionId, source: 'configuration' } : undefined;
}
