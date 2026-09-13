import type { Actor, PublishRequest, ReleaseDto, ReleaseId, ServiceId } from '@crewstation/contracts';
import { DomainTopic } from '@crewstation/contracts';
import { conflict, newId, notFound } from '@crewstation/kernel';
import type { Release } from '../domain/release';
import { initialSlots, standbyOf } from '../domain/slots';
import type { ReleaseUseCaseDeps } from './dependencies';
import { releaseToDto } from './toDto';

/** 发布是独立动作（R35）：平台打标签→登记 Release→流水线异步推进到待命槽；同一服务同时只有一条发布在进行。 */
export function publishUseCase(deps: ReleaseUseCaseDeps) {
  const { uow, tagger, authorizer, services, jobs, clock } = deps;
  return async (actor: Actor, serviceId: ServiceId, input: PublishRequest): Promise<ReleaseDto> => {
    const svc = await services.resolveServiceById(serviceId);
    if (!svc) throw notFound('服务', serviceId);
    await authorizer.authorize(actor, svc.projectId, 'publish');
    const inProgress = await uow.read.releases.findInProgress(serviceId);
    if (inProgress) throw conflict(`发布 ${inProgress.tag} 仍在进行中（${inProgress.status}）`, { releaseId: inProgress.id });
    const { tag, commitSha } = await tagger.createReleaseTag(serviceId, { branch: input.branch, version: input.version, ...(input.expectedCommitSha ? { expectedCommitSha: input.expectedCommitSha } : {}) });
    const now = clock.now();
    const dto = await uow.run(async (scope) => {
      const slots = (await scope.slots.get(serviceId)) ?? initialSlots(serviceId, now);
      await scope.slots.save(slots);
      const release: Release = {
        id: newId('rel') as ReleaseId, serviceId, projectId: svc.projectId, tag, commitSha, branch: input.branch,
        status: 'pending', targetSlot: standbyOf(slots.active), pipeline: { step: 0 },
        ...(input.message ? { message: input.message } : {}), createdBy: actor.userId, createdAt: now, updatedAt: now,
      };
      await scope.releases.insert(release);
      await scope.events.publish(DomainTopic.releaseStatusChanged, { occurredAt: now.toISOString(), serviceId, releaseId: release.id, status: 'pending' });
      return releaseToDto(release, slots);
    });
    await jobs.enqueuePipelineStep(dto.id, 0, 0);
    return dto;
  };
}
