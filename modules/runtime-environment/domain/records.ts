import type {
  RuntimeImageBuildDto, RuntimeImageBuildRender, RuntimeImageDto, RuntimeImageExecutionSnapshot, RuntimeImageRevisionDto, RuntimeImageValidationDto, RuntimeImageVersionDto, SaveDevelopmentRuntimeImages,
} from '@crewstation/contracts';
import type { InspectedImage } from './inspectedImage';

export type RuntimeImage = RuntimeImageDto;
export type ImageRevision = RuntimeImageRevisionDto;
export type ImageVersion = RuntimeImageVersionDto;
export interface ImageBuild extends RuntimeImageBuildDto {
  readonly requestKey: string;
  readonly inputDigest: string;
  readonly epoch: number;
  readonly leaseOwner?: string;
  readonly leaseUntil?: string;
  readonly cancelRequestKey?: string;
  readonly executionEpoch: number;
  readonly resourcePlan?: RuntimeImageBuildRender;
  readonly gitCredentialIds?: readonly string[];
  readonly podUid?: string;
  readonly logCursor?: string;
  readonly pendingOutcome?: { readonly state: 'succeeded'; readonly image: InspectedImage } | { readonly state: 'failed'; readonly error: string };
}
export interface ImageValidation extends RuntimeImageValidationDto {
  readonly deadline?: string;
  readonly executionStartedAt?: string;
  readonly pendingOutcome?: { readonly verification?: 'runtime' | 'service-contract'; readonly state: 'passed' | 'failed' | 'unknown'; readonly observedImageId?: string; readonly error?: string; readonly checks: RuntimeImageValidationDto['checks'] };
  readonly cancelRequestKey?: string;
  readonly initializerSecretVersions?: RuntimeImageExecutionSnapshot['initializerSecretVersions'];
  readonly requestKey: string;
  readonly inputDigest: string;
  readonly epoch: number;
  readonly leaseOwner?: string;
  readonly leaseUntil?: string;
}
export interface ImageReference {
  readonly id: string;
  readonly versionId: string;
  readonly projectId: string;
  readonly ownerType: 'release' | 'task' | 'agent' | 'session' | 'development-config' | 'validation';
  readonly ownerId: string;
  readonly state: 'reserved' | 'confirmed';
  readonly expiresAt: string | null;
  readonly createdAt: string;
  readonly snapshot?: RuntimeImageExecutionSnapshot;
  readonly snapshotInputDigest?: string;
}
export interface ImageLogChunk { readonly sequence: number; readonly stage: string; readonly text: string; readonly createdAt: string }
export interface DevelopmentImagePolicy extends Omit<SaveDevelopmentRuntimeImages, 'expectedRevision'> { readonly projectId: string; readonly revision: number }
