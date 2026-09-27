import type { Actor, ProjectId, RuntimeImageExecutionSnapshot } from '@crewstation/contracts';

/** 每个位置独立解析项目策略；返回通过用途验证且已经预留的不可变快照。 */
export interface DevelopmentRuntimeImages {
  reserve(actor: Actor, projectId: ProjectId, owner: { type: 'session' | 'agent'; id: string }, requested?: string, profile?: { profileId: string; revision: number }): Promise<RuntimeImageExecutionSnapshot | undefined>;
  confirm(snapshot: RuntimeImageExecutionSnapshot, owner: { type: 'session' | 'agent'; id: string }): Promise<void>;
  restore(projectId: ProjectId, snapshot: RuntimeImageExecutionSnapshot, from: string, to: string): Promise<void>;
}
