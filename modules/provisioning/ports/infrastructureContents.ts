import type { InfrastructureContentRow, InfrastructureOrphanError } from '../domain/infrastructureContents';

export interface InfrastructureContentReader {
  /** Every page starts strictly after the original bigint ID; an empty page establishes EOF. */
  queue(after: string | null): Promise<readonly InfrastructureContentRow[]>;
  event(after: string | null): Promise<readonly InfrastructureContentRow[]>;
  orphanErrors(after: Pick<InfrastructureOrphanError, 'eventId' | 'consumer'> | null): Promise<readonly InfrastructureOrphanError[]>;
}
export interface InfrastructureContentSource {
  /** All three traversals share one actual read-only, repeatable-read database snapshot. */
  withSnapshot<T>(read: (reader: InfrastructureContentReader) => Promise<T>): Promise<T>;
}
