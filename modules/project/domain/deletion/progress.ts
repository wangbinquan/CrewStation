import { PROJECT_DELETION_PARTICIPANTS, PROJECT_DELETION_PHASES } from '@crewstation/contracts';
import type { ProjectDeletionOperation, ProjectDeletionParticipant, ProjectDeletionPhase } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';

export function phaseComplete(operation: ProjectDeletionOperation, phase: ProjectDeletionPhase): boolean {
  return PROJECT_DELETION_PARTICIPANTS.every((participant) => operation.receipts.some((r) => r.participant === participant && r.phase === phase));
}
export function nextDeletionPhase(operation: ProjectDeletionOperation): ProjectDeletionPhase {
  return PROJECT_DELETION_PHASES.find((phase) => !phaseComplete(operation, phase)) ?? 'verify';
}
export function assertDeletionPhase(operation: ProjectDeletionOperation, participant: ProjectDeletionParticipant, phase: ProjectDeletionPhase) {
  if (!PROJECT_DELETION_PARTICIPANTS.includes(participant)) throw precondition('未登记的清理参与者');
  const before = PROJECT_DELETION_PHASES.slice(0, PROJECT_DELETION_PHASES.indexOf(phase));
  if (!before.every((p) => phaseComplete(operation, p))) throw precondition('前序清理屏障尚未齐全', { phase, required: nextDeletionPhase(operation) });
}
export function assertDeletionComplete(operation: ProjectDeletionOperation) {
  if (!PROJECT_DELETION_PHASES.every((phase) => phaseComplete(operation, phase))) throw precondition('所有参与者的实际清理和复盘证明尚未齐全');
}
