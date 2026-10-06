import type { UsageRecord } from '@crewstation/contracts';
import type { UsageContributionEvidence } from '../domain/completeUsageEvidence';

export type CompletePagedUsageScope = Extract<NonNullable<UsageRecord['scope']>, { native: unknown }>;
/** The composition boundary supplies the original bounded derived-row cache. */
export interface CompleteNativeCache<T> {
  get(key: string): Promise<T | undefined>;
  put(key: string, document: T): Promise<void>;
  flush(): Promise<void>;
}
export type CompleteNativeCacheFactory = <T>(namespace: string) => CompleteNativeCache<T>;
/** Original source/path metadata only; no token amount or alternate projection. */
export interface CompleteNativePath {
  readonly root: string;
  readonly session: string;
  readonly parentSession: string | null;
  readonly depth: string;
  readonly pathDigest: string;
  readonly sourceNamespace: string;
}
/** Both functions read the same original report snapshot and actual sealed source. */
export interface CompleteNativeScopeSource {
  qualify(record: UsageContributionEvidence): Promise<void>;
  path(scope: CompletePagedUsageScope, session: string): Promise<CompleteNativePath>;
}
export interface CompleteCoverageSession {
  readonly id: string;
  readonly treeOnly: boolean;
}
