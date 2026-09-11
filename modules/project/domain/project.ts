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

/** 每项目一个命名空间（G18）；前缀固定，便于集群侧按前缀识别平台资源。 */
export function namespaceFor(slug: string): string {
  return `cs-${slug}`;
}

const TRANSITIONS: Record<ProjectState, readonly ProjectState[]> = {
  provisioning: ['active', 'failed'],
  active: ['paused', 'archived'],
  paused: ['active', 'archived'],
  failed: ['provisioning', 'archived'],
  archived: [],
};

export function transition(project: Project, next: ProjectState, now: Date, message?: string): Project {
  if (!TRANSITIONS[project.state].includes(next)) {
    throw precondition(`项目 ${project.slug} 不能从 ${project.state} 进入 ${next}`, { from: project.state, to: next });
  }
  return { ...project, state: next, updatedAt: now, ...(message === undefined ? {} : { message }) };
}
