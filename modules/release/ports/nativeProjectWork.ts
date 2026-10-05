import type { ProjectDeletionContext, ProjectDeletionTarget } from '@crewstation/contracts';
import type { ReleaseDeletionContent, ReleasePhysicalScope } from '../domain/release';
import type { ReleasePhysicalReport, ReleasePhysicalProof } from './unitOfWork';

export interface ReleaseNativeWorkSnapshot {
  identity: string; epoch: string; body: unknown;
  objects: ReadonlyArray<ReleasePhysicalScope['objects'][number]>;
}
export interface ReleaseNativeWorkSource {
  capture(target: ProjectDeletionTarget, content: ReleaseDeletionContent): Promise<ReleasePhysicalReport & { native: ReleaseNativeWorkSnapshot }>;
  inspect(original: ReleaseNativeWorkSnapshot): Promise<ReleasePhysicalReport>;
  stop(context: ProjectDeletionContext, original: ReleaseNativeWorkSnapshot): Promise<ReleasePhysicalProof>;
  purge(context: ProjectDeletionContext, original: ReleaseNativeWorkSnapshot): Promise<ReleasePhysicalProof>;
  prove(context: ProjectDeletionContext, original: ReleaseNativeWorkSnapshot): Promise<ReleasePhysicalProof>;
  callbackExit(original: ReleaseDeletionContent['callbacks'][number]): Promise<string | undefined>;
}
