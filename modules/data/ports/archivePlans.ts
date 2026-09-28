import type { ArchivePlanEntry, ArchivePlanPage } from '@crewstation/contracts';
import type { ArchivePlanRecord } from '../domain/objectStorage';
import type { UploadAuthority } from './objectStorage';
import type { UserId } from '@crewstation/contracts';

export interface ArchivePlanAuthority extends UploadAuthority { readonly operator?: { readonly userId: UserId; readonly reason: string } }

/** The application must verify task ownership before supplying taskId. */
export interface ArchivePlanRepository {
  create(spaceId: string, taskId: string, id: string, requestKey: string, authority: ArchivePlanAuthority): Promise<ArchivePlanRecord>;
  get(id: string): Promise<ArchivePlanRecord | undefined>;
  file(id: string, path: string): Promise<Extract<ArchivePlanEntry, { kind: 'file' }> | undefined>;
  append(id: string, input: ArchivePlanPage, authority: ArchivePlanAuthority): Promise<ArchivePlanRecord>;
  seal(id: string, requestKey: string, expectedRevision: number, authority: ArchivePlanAuthority): Promise<ArchivePlanRecord>;
  abort(id: string, expectedRevision: number, authority: ArchivePlanAuthority): Promise<ArchivePlanRecord>;
}
