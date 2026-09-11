import { DomainTopic } from '@crewstation/contracts';
import type { Release } from '../domain/release';
import { advance } from '../domain/release';
import { withSlot } from '../domain/slots';
import type { ReleaseUseCaseDeps } from './dependencies';

export interface StepResult { done: boolean; retryAfterSeconds: number }
export type ResolvedService = NonNullable<Awaited<ReturnType<ReleaseUseCaseDeps['services']['resolveServiceById']>>>;
export const WAIT: StepResult = { done: false, retryAfterSeconds: 5 };
export const DONE: StepResult = { done: true, retryAfterSeconds: 0 };

export interface PipelineContext {
  /** 状态迁移并落库；每次都递增 step，供工作器用唯一键重新入队。 */
  save(release: Release, status: Release['status'], patch?: Partial<Release>, message?: string): Promise<Release>;
  fail(release: Release, message: string): Promise<StepResult>;
  /** 轮询未结束：只递增 step。 */
  bump(release: Release): Promise<void>;
}

export function createPipelineContext({ uow, clock, logger }: ReleaseUseCaseDeps): PipelineContext {
  const save: PipelineContext['save'] = async (release, status, patch = {}, message) => {
    const now = clock.now();
    const next = advance(release, status, now, { ...patch, pipeline: { ...release.pipeline, ...(patch.pipeline ?? {}), step: release.pipeline.step + 1 }, ...(message ? { message } : {}) });
    await uow.run(async (scope) => {
      await scope.releases.update(next);
      if (status === 'failed' && release.status === 'deploying') {
        const slots = await scope.slots.get(release.serviceId);
        if (slots) await scope.slots.save(withSlot(slots, { ...slots[release.targetSlot], state: 'failed', updatedAt: now }, now));
      }
      await scope.events.publish(DomainTopic.releaseStatusChanged, { occurredAt: now.toISOString(), serviceId: release.serviceId, releaseId: release.id, status, ...(message ? { message } : {}) });
    });
    return next;
  };
  return {
    save,
    fail: async (release, message) => {
      logger.warn('release failed', { releaseId: release.id, tag: release.tag, message });
      await save(release, 'failed', {}, message);
      return DONE;
    },
    bump: async (release) => {
      await uow.run((scope) => scope.releases.update({ ...release, pipeline: { ...release.pipeline, step: release.pipeline.step + 1 } }));
    },
  };
}
