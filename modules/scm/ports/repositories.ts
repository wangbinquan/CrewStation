import type { ServiceId } from '@crewstation/contracts';
import type { RepositoryBinding } from '../domain/repositoryBinding';
import type { SessionCredential } from '../domain/sessionCredential';

export interface RepositoryBindingRepository {
  getByServiceId(serviceId: ServiceId): Promise<RepositoryBinding | undefined>;
  getByPath(pathWithNamespace: string): Promise<RepositoryBinding | undefined>;
  upsert(binding: RepositoryBinding): Promise<void>;
}

export interface SessionCredentialRepository {
  insert(credential: SessionCredential): Promise<void>;
  getById(id: string): Promise<SessionCredential | undefined>;
  /** 未撤销且 `expiresAt <= now` 的凭据。 */
  listExpired(now: Date): Promise<SessionCredential[]>;
  markRevoked(id: string, at: Date): Promise<void>;
}
