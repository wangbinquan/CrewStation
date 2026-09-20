import type { EnvironmentRebuild } from '../domain/environmentRebuild';

export const REBUILD_JOB_KIND = 'task-runtime.rebuild';

export interface RebuildRepository {
  findRequest(projectId: string, requestId: string): Promise<EnvironmentRebuild | undefined>;
  get(id: string): Promise<EnvironmentRebuild | undefined>;
  pending(): Promise<EnvironmentRebuild[]>;
  insert(record: EnvironmentRebuild): Promise<void>;
  update(record: EnvironmentRebuild): Promise<void>;
}

export interface RebuildQueue {
  enqueue(requestId: string): Promise<void>;
}
