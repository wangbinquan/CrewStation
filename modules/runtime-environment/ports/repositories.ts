import type { ProjectRuntimeImagePolicy, RuntimeImageGrants } from '@crewstation/contracts';
import type { ImageBuild, ImageRevision, ImageValidation, ImageVersion, RuntimeImage, ImageReference, ImageLogChunk, DevelopmentImagePolicy } from '../domain/records';

export interface Page { readonly before?: string; readonly limit: number; readonly search?: string }
export interface ImageRepository {
  listAll(page: Page): Promise<RuntimeImage[]>;
  get(id: string, lock?: boolean): Promise<RuntimeImage | undefined>;
  list(projectId: string, page: Page, includeShared?: boolean, policy?: ProjectRuntimeImagePolicy): Promise<RuntimeImage[]>;
  insert(image: RuntimeImage): Promise<void>;
  update(image: RuntimeImage): Promise<void>;
  grant(imageId: string, projectId: string): Promise<void>;
  granted(imageId: string, projectId: string): Promise<boolean>;
  grants(imageId: string): Promise<Omit<RuntimeImageGrants, 'defaultVisible'>>;
}
export interface RevisionRepository {
  get(id: string): Promise<ImageRevision | undefined>;
  list(imageId: string, page: Page): Promise<ImageRevision[]>;
  insert(revision: ImageRevision): Promise<void>;
  next(imageId: string): Promise<number>;
}
export interface BuildRepository {
  get(id: string, lock?: boolean): Promise<ImageBuild | undefined>;
  findRequest(imageId: string, actorId: string, key: string): Promise<ImageBuild | undefined>;
  insert(build: ImageBuild): Promise<void>;
  update(build: ImageBuild): Promise<void>;
  list(imageId: string, page: Page): Promise<ImageBuild[]>;
  activeCount(projectId?: string): Promise<number>;
  runnable(at: string, limit: number): Promise<ImageBuild[]>;
}
export interface VersionRepository {
  ids(imageId: string): Promise<string[]>;
  get(id: string, lock?: boolean): Promise<ImageVersion | undefined>;
  insert(version: ImageVersion): Promise<void>;
  update(version: ImageVersion): Promise<void>;
  list(imageId: string, page: Page): Promise<ImageVersion[]>;
  byBuild(buildId: string): Promise<ImageVersion | undefined>;
  byDigest(repository: string, digest: string): Promise<ImageVersion[]>;
}
export interface ValidationRepository {
  get(id: string, lock?: boolean): Promise<ImageValidation | undefined>;
  insert(validation: ImageValidation): Promise<void>;
  update(validation: ImageValidation): Promise<void>;
  list(versionId: string): Promise<ImageValidation[]>;
  findRequest(versionId: string, actorId: string, key: string): Promise<ImageValidation | undefined>;
  findPassed(versionId: string, contractDigest: string): Promise<ImageValidation | undefined>;
  runnable(at: string, limit: number): Promise<ImageValidation[]>;
}
export interface ReferenceRepository {
  scan(after: string | undefined, limit: number): Promise<ImageReference[]>;
  get(versionId: string, ownerType: ImageReference['ownerType'], ownerId: string): Promise<ImageReference | undefined>;
  insert(ref: ImageReference): Promise<void>;
  update(ref: ImageReference): Promise<void>;
  remove(id: string): Promise<void>;
  list(versionId: string): Promise<ImageReference[]>;
}
export interface LogRepository {
  append(buildId: string, chunk: Omit<ImageLogChunk, 'sequence'>): Promise<void>;
  page(buildId: string, after: number, limit: number): Promise<ImageLogChunk[]>;
  bytes(buildId: string): Promise<number>;
}
export interface DevelopmentPolicyRepository {
  get(projectId: string): Promise<DevelopmentImagePolicy | undefined>;
  save(policy: DevelopmentImagePolicy): Promise<void>;
}
