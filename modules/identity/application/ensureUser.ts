import type { UserDto, UserId } from '@crewstation/contracts';
import type { Clock } from '@crewstation/kernel';
import { newId } from '@crewstation/kernel';
import type { ExternalUser } from '../api/moduleApi';
import type { User } from '../domain/user';
import { shouldBootstrapAdmin } from '../domain/user';
import type { IdentitySettings } from '../ports/identitySettings';
import type { UserRepository } from '../ports/userRepository';

export interface EnsureUserDeps { users: UserRepository; settings: IdentitySettings; clock: Clock }

export function ensureUserUseCase({ users, settings, clock }: EnsureUserDeps) {
  return async (external: ExternalUser): Promise<UserDto> => {
    const existing = await users.getByExternalId(external.externalId);
    const now = clock.now();
    if (existing) {
      const updated: User = { ...existing, name: external.name, email: external.email, lastLoginAt: now };
      await users.update(updated);
      return toDto(updated);
    }
    const created: User = {
      id: newId('usr') as UserId,
      externalId: external.externalId,
      username: null,
      name: external.name,
      email: external.email,
      gitName: null,
      passwordHash: null,
      isAdmin: shouldBootstrapAdmin(external.email, settings.adminEmails, await users.count()),
      createdAt: now,
      lastLoginAt: now,
    };
    await users.insert(created);
    return toDto(created);
  };
}

export function toDto(user: User): UserDto {
  return { id: user.id, name: user.name, email: user.email, isAdmin: user.isAdmin };
}
