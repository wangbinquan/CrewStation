import type { ManifestKind, ProjectId, ProjectState, UserId } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';

export interface Project {
  readonly id: ProjectId;
  readonly slug: string;
  readonly name: string;
  readonly kind: ManifestKind;
  readonly namespace: string;
  readonly ownerUserId: UserId;
  readonly state: ProjectState;
  readonly template: string;
  readonly message?: string;
  readonly createdBy: UserId;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** 与网关主机模式冲突的保留名（console.<域>、preview.<项目>.<域>、api.<服务域> 等）。 */
export const RESERVED_SLUGS: readonly string[] = ['console', 'preview', 'dev', 'api', 'www', 'auth', 'crewstation'];

/** 每项目一个命名空间（G18）；前缀固定，便于集群侧按前缀识别平台资源。 */
export function namespaceFor(slug: string): string {
  return `cs-${slug}`;
}

const TRANSITIONS: Record<ProjectState, readonly ProjectState[]> = {
  provisioning: ['active', 'failed'],
  // active→active 是「重跑开通链确认一切就位」：管理员对已 active 的项目重开通时，
  // 它是唯一能把上一次的失败原因清掉的路径，否则那行原因会永远挂在工作台上。
  active: ['active', 'paused', 'archived'],
  paused: ['active', 'archived'],
  failed: ['provisioning', 'archived'],
  archived: [],
};

/**
 * message 记录的是「当前状态的原因」，只对 failed 有意义：
 * 迁到别的状态而未给新原因时必须清掉，否则 active 的项目会一直挂着上一次的失败原因。
 */
export function transition(project: Project, next: ProjectState, now: Date, message?: string): Project {
  if (!TRANSITIONS[project.state].includes(next)) {
    throw precondition(`项目 ${project.slug} 不能从 ${project.state} 进入 ${next}`, { from: project.state, to: next });
  }
  const { message: _dropped, ...rest } = project;
  return { ...rest, state: next, updatedAt: now, ...(message === undefined ? {} : { message }) };
}
