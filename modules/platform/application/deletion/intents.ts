import type { ProjectDeletionOperation } from '@crewstation/contracts';
import type { DeletionLease, RootDeletionIntents } from '../../ports/deletion/intents';

export interface RootDeletionProject {
  deletionScope: RootDeletionIntents['scope']; prepareDeletionPlan: RootDeletionIntents['prepare'];
  acceptProjectDeletion: RootDeletionIntents['accept']; replayProjectDeletion: RootDeletionIntents['replay'];
  readProjectDeletion: RootDeletionIntents['read']; findProjectDeletion: RootDeletionIntents['find']; retryProjectDeletion: RootDeletionIntents['retry'];
  prepareProjectDeletionReconfirmation: RootDeletionIntents['prepareReconfirmation']; replayProjectDeletionReconfirmation: RootDeletionIntents['replayReconfirmation'];
  reconfirmProjectDeletion: RootDeletionIntents['reconfirm']; claimProjectDeletion: RootDeletionIntents['claim']; renewProjectDeletion: RootDeletionIntents['renew'];
  deferProjectDeletion: RootDeletionIntents['defer']; recordProjectDeletionReceipt: RootDeletionIntents['receipt']; blockProjectDeletion: RootDeletionIntents['block'];
  coordinateProjectDeletion: RootDeletionIntents['coordinate']; listPendingProjectDeletions: RootDeletionIntents['pending'];
  completeProjectDeletion(lease: DeletionLease, finalize: (executor: object, operation: ProjectDeletionOperation) => Promise<void>): ReturnType<RootDeletionIntents['complete']>;
}

/** Completion removes the original coordinator in the same Project transaction. */
export function projectDeletionIntents(project: RootDeletionProject, finalize: (executor: object, operation: ProjectDeletionOperation) => Promise<void>): RootDeletionIntents {
  return {
    scope: project.deletionScope, prepare: project.prepareDeletionPlan, accept: project.acceptProjectDeletion, replay: project.replayProjectDeletion,
    read: project.readProjectDeletion, find: project.findProjectDeletion, retry: project.retryProjectDeletion,
    prepareReconfirmation: project.prepareProjectDeletionReconfirmation, replayReconfirmation: project.replayProjectDeletionReconfirmation, reconfirm: project.reconfirmProjectDeletion,
    claim: project.claimProjectDeletion, renew: project.renewProjectDeletion, defer: project.deferProjectDeletion, receipt: project.recordProjectDeletionReceipt,
    block: project.blockProjectDeletion, complete: (lease) => project.completeProjectDeletion(lease, finalize),
    coordinate: project.coordinateProjectDeletion, pending: project.listPendingProjectDeletions,
  };
}
