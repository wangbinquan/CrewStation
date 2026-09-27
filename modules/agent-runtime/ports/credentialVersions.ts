import type { CredentialVersion } from '../domain/credentialVersion';
export interface CredentialVersions {
  get(profileId: string, revision: number, stamp: string): Promise<CredentialVersion | undefined>;
  save(version: CredentialVersion): Promise<void>;
}
