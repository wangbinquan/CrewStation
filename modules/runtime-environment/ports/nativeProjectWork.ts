import type { ProjectDeletionContext, ProjectDeletionTarget } from '@crewstation/contracts';
import type { RuntimeImageProjectContent } from './repositories';
import type { RuntimeImagePhysicalReport, RuntimeImagePhysicalProof, RuntimeImagePhysicalScope } from './projectDeletion';

export interface RuntimeImageNativeWorkSnapshot {
  identity: string; epoch: string; body: unknown;
  objects: ReadonlyArray<Omit<RuntimeImagePhysicalScope['objects'][number], 'consumerId' | 'consumerIdentity'>>;
}
export interface RuntimeImageNativeWorkSource {
  capture(target: ProjectDeletionTarget, content: RuntimeImageProjectContent): Promise<RuntimeImagePhysicalReport & { native: RuntimeImageNativeWorkSnapshot }>;
  inspect(original: RuntimeImageNativeWorkSnapshot): Promise<RuntimeImagePhysicalReport>;
  stop(context: ProjectDeletionContext, original: RuntimeImageNativeWorkSnapshot): Promise<RuntimeImagePhysicalProof>;
  purge(context: ProjectDeletionContext, original: RuntimeImageNativeWorkSnapshot): Promise<RuntimeImagePhysicalProof>;
  prove(context: ProjectDeletionContext, original: RuntimeImageNativeWorkSnapshot): Promise<RuntimeImagePhysicalProof>;
  callbackExit(original: RuntimeImageProjectContent['callbacks'][number]): Promise<string | undefined>;
}
