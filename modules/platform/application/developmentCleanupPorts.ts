import { TaskIdSchema } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { DevelopmentCleanupParticipant, DevelopmentCleanupQuery } from '../ports/developmentCleanup';

/** Explicit cross-owner adapter, deliberately absent from production platform wiring. */
export function developmentCleanupPort(task: DevelopmentCleanupQuery, owner: DevelopmentCleanupParticipant): DevelopmentCleanupParticipant {
  return { advance: async (input) => {
    const selection = await task.inspectDevelopmentCleanupSelection?.(TaskIdSchema.parse(input.identity.executionId));
    if (!selection || jsonHash(selection) !== jsonHash(input)) return { kind: 'waiting', reason: 'task-selection' };
    const result = await owner.advance(input);
    if (result.kind === 'permitted' && jsonHash(result.evidence.selection) !== jsonHash(selection)) throw precondition('数字 owner 返回了其他开发清理选择');
    return result;
  } };
}
