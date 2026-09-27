/** 资源调和器为当前不可变重建意图提供的操作；没有创建或删除工作卷的能力。 */
export interface RebuildRendering {
  prepareSecret(values: () => Promise<Record<string, string>>, expectedUid?: string): Promise<{ uid: string; token: string }>;
  ensurePod(expectedUid?: string): Promise<string>;
  ensurePreview(): Promise<void>;
  cleanup(instances: { podUid?: string; secretUid?: string }): Promise<void>;
}
