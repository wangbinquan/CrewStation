import type { PlatformRole, UserId } from '@crewstation/contracts';
import type { User } from '../domain/user';

export interface UserRepository {
  getById(id: UserId): Promise<User | undefined>;
  getByExternalId(externalId: string): Promise<User | undefined>;
  getByEmail(email: string): Promise<User | undefined>;
  getByUsername(username: string): Promise<User | undefined>;
  count(): Promise<number>;
  countAdmins(): Promise<number>;
  setPlatformRole(id: UserId, role: PlatformRole): Promise<void>;
  uninitializedRoles(limit: number): Promise<User[]>;
  initializeRole(id: UserId, role: PlatformRole): Promise<boolean>;
  list(): Promise<User[]>;
  insert(user: User): Promise<void>;
  update(user: User): Promise<void>;
}
