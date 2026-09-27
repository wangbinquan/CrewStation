import type { WorkloadRender } from './workloadRender';

export interface RebuildRender { readonly id: string; readonly volumeUid: string; readonly intent: string }
/** 只接收完整的保卷重建，不允许借此创建空卷或重新检出。 */
export function rebuildRenderOf(value: unknown, render: WorkloadRender): RebuildRender | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const fields = value as Record<string, unknown>;
  if (![fields['id'], fields['volumeUid'], fields['intent']].every((entry) => typeof entry === 'string' && entry.length > 0)) return undefined;
  const { pod } = render;
  if (!pod.pvc || pod.emptyDir || pod.checkout || pod.labels?.['crewstation.io/rebuild'] !== fields['id'] || pod.annotations?.['crewstation.io/rebuild-intent'] !== fields['intent']) return undefined;
  return { id: fields['id'] as string, volumeUid: fields['volumeUid'] as string, intent: fields['intent'] as string };
}
