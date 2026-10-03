import { jsonHash, newResourceId, precondition } from '@crewstation/kernel';
import { DevelopmentUsagePreparationSchema } from '../../domain/developmentUsage';
import type { DevelopmentCleanupParticipant } from '../../ports/developmentCleanup';
import type { DevelopmentUsageOwner } from '../../ports/developmentUsage';
import type { DevelopmentProjectWork } from '../../ports/deletion/work';

/** Public identity readers stay usable during inspection. Every ordinary owner mutation has its own original lifetime. */
export function developmentUsageWork(owner: DevelopmentUsageOwner, work: DevelopmentProjectWork): DevelopmentUsageOwner {
  const guarded = { ...owner };
  for (const name of ['prepare', 'bind', 'observeSupported', 'unsupported', 'close'] as const) Object.defineProperty(guarded, name, {
    enumerable: true, value: (...args: unknown[]) => {
      const originKey = name === 'prepare' ? DevelopmentUsagePreparationSchema.parse(args[0]).intent.identity.taskId : args[0];
      if (typeof originKey !== 'string') return Promise.reject(precondition('开发数字写入缺少原任务身份'));
      return work.runOrigin({ originKind: 'task', originKey, kind: 'usage', reference: newResourceId(), inputDigest: jsonHash({ method: name, args }) },
        () => Reflect.apply(owner[name], owner, args));
    },
  });
  return guarded;
}
/** Cleanup commands retain their actual transport effects after a bounded caller response or disconnect. */
export function developmentCleanupWork(participant: DevelopmentCleanupParticipant, work: DevelopmentProjectWork): DevelopmentCleanupParticipant {
  return { advance: (input) => work.runOrigin({ originKind: 'task', originKey: input.identity.executionId, kind: 'ending',
    reference: newResourceId(), inputDigest: jsonHash(input) }, () => participant.advance(input)) };
}
