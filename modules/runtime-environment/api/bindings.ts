import type { Actor, RuntimeImageExecutionSnapshot, RuntimeImageSelection, RuntimeImageValidationTarget } from '@crewstation/contracts';

export interface ImageReferenceOwner { readonly type: 'release' | 'task' | 'agent' | 'session' | 'development-config' | 'validation'; readonly id: string }
export interface ImageReservationInput {
  readonly requestedVersionId?: string;
  readonly selection: RuntimeImageSelection;
  readonly target: RuntimeImageValidationTarget;
  readonly owner: ImageReferenceOwner;
}
export interface ImageReferenceView {
  readonly id: string; readonly versionId: string; readonly projectId: string;
  readonly ownerType: ImageReferenceOwner['type']; readonly ownerId: string;
  readonly state: 'reserved' | 'confirmed'; readonly expiresAt: string | null; readonly createdAt: string;
}
/** 只给组合根接线，不暴露为可由浏览器任意释放引用的 HTTP 端点。 */
export interface RuntimeImageBindings {
  renderInitializationSecrets(projectId: string, owner: ImageReferenceOwner, snapshot: RuntimeImageExecutionSnapshot): Promise<Record<string, string>>;
  copyReference(projectId: string, versionId: string, from: ImageReferenceOwner, to: ImageReferenceOwner): Promise<void>;
  reserveImage(actor: Actor, projectId: string, input: ImageReservationInput): Promise<RuntimeImageExecutionSnapshot | undefined>;
  confirmReference(versionId: string, owner: ImageReferenceOwner): Promise<void>;
  releaseReference(versionId: string, owner: ImageReferenceOwner): Promise<void>;
}
