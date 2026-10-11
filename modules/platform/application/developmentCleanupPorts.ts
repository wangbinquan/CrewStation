import { TaskIdSchema } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { DevelopmentCleanupParticipant, DevelopmentCleanupQuery, DevelopmentCleanupSelection } from '../ports/developmentCleanup';

/** Both owner actions revalidate the immutable Task selection before and after owner I/O. */
export function developmentCleanupPort(task: DevelopmentCleanupQuery, owner: DevelopmentCleanupParticipant): DevelopmentCleanupParticipant {
  const run = async (input: DevelopmentCleanupSelection, action: 'advance' | 'completePrestart') => {
    const id = TaskIdSchema.parse(input.identity.executionId), selection = await task.inspectDevelopmentCleanupSelection?.(id);
    if (!selection || jsonHash(selection) !== jsonHash(input)) return { kind: 'waiting' as const, reason: 'task-selection' };
    const method = owner[action];
    if (!method) return { kind: 'waiting' as const, reason: 'prestart-capability' };
    const result = await Reflect.apply(method, owner, [input]);
    const after = await task.inspectDevelopmentCleanupSelection?.(id);
    if (!after || jsonHash(after) !== jsonHash(selection)) return { kind: 'waiting' as const, reason: 'task-selection' };
    if (action === 'completePrestart' && result.kind === 'permitted' && (result.evidence.version !== 2 || result.evidence.phase !== 'closed'))
      throw precondition('未获准启动完成动作必须返回独立闭合出口');
    if (result.kind === 'permitted' && jsonHash(result.evidence.selection) !== jsonHash(selection)) throw precondition('数字 owner 返回了其他开发清理选择');
    return result;
  };
  return { advance: (input) => run(input, 'advance'), completePrestart: (input) => run(input, 'completePrestart') };
}
/** Resolve both original public owners lazily after the platform composition has finished. */
export function forwardDevelopmentCleanup(task: () => DevelopmentCleanupQuery, owner: () => DevelopmentCleanupParticipant | undefined): DevelopmentCleanupParticipant {
  const run = (input: DevelopmentCleanupSelection, action: 'advance' | 'completePrestart') => {
    const current = owner();
    if (!current) return Promise.resolve({ kind: 'waiting' as const, reason: 'development-owner-unavailable' });
    const port = developmentCleanupPort(task(), current);
    return port[action]!(input);
  };
  return { advance: (input) => run(input, 'advance'), completePrestart: (input) => run(input, 'completePrestart') };
}
