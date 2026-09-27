import type { RuntimeImageBuildState } from '@crewstation/contracts';
import { conflict } from '@crewstation/kernel';

const NEXT: Record<RuntimeImageBuildState, readonly RuntimeImageBuildState[]> = {
  queued: ['preparing', 'cancelling', 'failed'], preparing: ['building', 'inspecting', 'cancelling', 'failed'],
  building: ['inspecting', 'cancelling', 'failed'], inspecting: ['succeeded', 'cancelling', 'failed'],
  cancelling: ['cancelled'], succeeded: [], failed: [], cancelled: [],
};
export const canTransitionBuild = (from: RuntimeImageBuildState, to: RuntimeImageBuildState): boolean => NEXT[from].includes(to);
export const occupiesBuildCapacity = (state: RuntimeImageBuildState): boolean => !['succeeded', 'failed', 'cancelled'].includes(state);
export function transitionImageBuild(from: RuntimeImageBuildState, to: RuntimeImageBuildState): RuntimeImageBuildState {
  if (!canTransitionBuild(from, to)) throw conflict(`镜像构建不能从 ${from} 转为 ${to}`, { code: 'image_build_transition' });
  return to;
}
