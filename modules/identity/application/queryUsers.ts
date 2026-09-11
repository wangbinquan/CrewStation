import type { UserDto, UserId } from '@crewstation/contracts';
import { notFound } from '@crewstation/kernel';
import type { UserRepository } from '../ports/userRepository';
import { toDto } from './ensureUser';

export function queryUsersUseCases(users: UserRepository) {
  return {
    getUser: async (userId: UserId): Promise<UserDto | undefined> => {
      const user = await users.getById(userId);
      return user ? toDto(user) : undefined;
    },
    findByEmail: async (email: string): Promise<UserDto | undefined> => {
      const user = await users.getByEmail(email);
      return user ? toDto(user) : undefined;
    },
    isAdmin: async (userId: UserId): Promise<boolean> => (await users.getById(userId))?.isAdmin ?? false,
    listUsers: async (): Promise<UserDto[]> => (await users.list()).map(toDto),
    setAdmin: async (userId: UserId, isAdmin: boolean): Promise<UserDto> => {
      const user = await users.getById(userId);
      if (!user) throw notFound('用户', userId);
      const updated = { ...user, isAdmin };
      await users.update(updated);
      return toDto(updated);
    },
  };
}
