import type { UserId } from '@crewstation/contracts';

export interface RoleMutationLock {
  run<T>(userId: UserId, work: () => Promise<T>): Promise<T>;
}
