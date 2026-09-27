import type { Actor, RuntimeImageSource } from '@crewstation/contracts';
import type { SourceTreeEntry } from '../domain/sourceTree';

export interface ImageSourceRepository {
  resolve(actor: Actor, projectId: string, bindingId: string, ref: string): Promise<{ commitSha: string; tree: readonly SourceTreeEntry[] }>;
  readFile(bindingId: string, commitSha: string, path: string): Promise<string | undefined>;
}
export interface ImageBuildBase {
  resolve(actor: Actor, projectId: string | undefined, source: RuntimeImageSource): Promise<string | undefined>;
}
export interface ExistingImageResolver {
  resolve(actor: Actor, projectId: string | undefined, reference: string, architecture: RuntimeImageSource['architecture']): Promise<string>;
}
