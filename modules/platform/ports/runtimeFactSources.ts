import type { RuntimeFactPage, RuntimeFactQuery } from '@crewstation/contracts';

/** Owner queries must receive the caller's one repeatable-read Executor. */
export interface RuntimeFactOwners<Snapshot> {
  business(executor: Snapshot, query: RuntimeFactQuery): Promise<RuntimeFactPage>;
  development(executor: Snapshot, query: RuntimeFactQuery): Promise<RuntimeFactPage>;
}
