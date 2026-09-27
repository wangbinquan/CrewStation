import type { ProjectId } from '@crewstation/contracts';

export interface AppIconImage { readonly content: string; readonly mime: 'image/webp' }
export interface AppIconImages {
  get(projectId: ProjectId): Promise<AppIconImage | undefined>;
  put(projectId: ProjectId, image: AppIconImage): Promise<void>;
  remove(projectId: ProjectId): Promise<void>;
}
export interface AppIconDecoder { normalize(bytes: Uint8Array): Promise<AppIconImage> }
