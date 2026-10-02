import { PROJECT_DELETION_PARTICIPANTS } from '@crewstation/contracts';
import type { ProjectDeletionPlan } from '@crewstation/contracts';

/** A returned plan is bound to one original project and all owners; an empty/missing owner is not an empty project. */
export function deletionPlanReady(plan: ProjectDeletionPlan | undefined, projectId: string, now = Date.now()): boolean {
  if (!plan || plan.target.id !== projectId || !plan.complete || plan.blockers.length || !Number.isFinite(Date.parse(plan.expiresAt)) || Date.parse(plan.expiresAt) <= now) return false;
  const names = plan.participants.map((owner) => owner.participant);
  return names.length === PROJECT_DELETION_PARTICIPANTS.length && new Set(names).size === names.length &&
    PROJECT_DELETION_PARTICIPANTS.every((owner) => names.includes(owner)) &&
    plan.participants.every((owner) => owner.complete && !owner.blockers.length && !owner.references.length);
}

export function deletionReviewRows(plan: ProjectDeletionPlan) {
  return plan.participants.map((owner) => ({ participant: owner.participant, complete: owner.complete,
    resources: owner.resources, count: owner.resources.reduce((sum, resource) => sum + resource.count, 0),
    blockers: owner.blockers, references: owner.references,
  }));
}
