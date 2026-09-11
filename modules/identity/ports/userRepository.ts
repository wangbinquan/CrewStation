import type { UserId } from '@crewstation/contracts';
import type { User } from '../domain/user';

export interface UserRepository {
  getById(id: UserId): Promise<User | undefined>;
  getByExternalId(externalId: string): Promise<User | undefined>;
  getByEmail(email: string): Promise<User | undefined>;
  count(): Promise<number>;
  list(): Promise<User[]>;
  insert(user: User): Promise<void>;
  update(user: User): Promise<void>;
}
