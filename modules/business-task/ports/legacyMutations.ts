import type { RepositoryScope } from './repositories';
export interface LegacyMutationTicket { id: string; serviceId: string; kind: string; taskId?: string; parentId?: string; ownerPodUid?: string }
export interface LegacyMutationRecord extends LegacyMutationTicket { state: 'open' | 'unknown' | 'complete'; createdAt: string }

/** Old protocols carry no fencing token. Every old write must cross this durable service barrier. */
export interface LegacyMutations {
  local<T>(ticket: LegacyMutationTicket, run: (scope: RepositoryScope) => Promise<T>): Promise<T>;
  list(serviceId: string): Promise<LegacyMutationRecord[]>;
  recover(ticket: LegacyMutationRecord): Promise<boolean>;
  childrenComplete(id: string): Promise<boolean>;
  begin(input: Omit<LegacyMutationTicket, 'id'>): Promise<LegacyMutationTicket>;
  settle(ticket: LegacyMutationTicket, state: 'complete' | 'unknown'): Promise<void>;
}
