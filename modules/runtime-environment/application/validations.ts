import type { Actor, StartImageValidation } from '@crewstation/contracts';
import { CancelRuntimeImageOperationSchema, RuntimeImageValidationDtoSchema, StartImageValidationSchema } from '@crewstation/contracts';
import { conflict, newResourceId, notFound } from '@crewstation/kernel';
import { imageContentDigest } from '../domain/contentDigest';
import type { ImageValidation } from '../domain/records';
import type { RuntimeImageDeps } from './dependencies';
import { compatibilityEvidence, requireAvailable, versionAccess, versionLock } from './compatibility';

export function runtimeImageValidations(deps: RuntimeImageDeps) {
  return {
    startValidation: async (actor: Actor, projectId: string, versionId: string, input: StartImageValidation) => {
      const parsed = StartImageValidationSchema.parse(input), inputDigest = imageContentDigest(parsed.target);
      await deps.authorizer.authorize(actor, projectId, 'develop');
      const { version, revision } = await versionAccess(deps, actor, projectId, versionId);
      const existing = await deps.uow.read.validations.findRequest(versionId, actor.userId, parsed.requestKey);
      if (existing) {
        if (existing.projectId !== projectId || existing.inputDigest !== inputDigest) throw conflict('同一验证请求键不能改变用途或档位', { code: 'idempotency_conflict' });
        return RuntimeImageValidationDtoSchema.parse(existing);
      }
      const { contractDigest, initializerSecretVersions } = await compatibilityEvidence(deps, actor, projectId, version, revision, parsed.target);
      return deps.uow.run(async (s) => {
        await s.lock(versionLock(version));
        const prior = await s.validations.findRequest(versionId, actor.userId, parsed.requestKey);
        if (prior) {
          if (prior.projectId !== projectId || prior.inputDigest !== inputDigest) throw conflict('同一验证请求键不能改变用途或档位', { code: 'idempotency_conflict' });
          return RuntimeImageValidationDtoSchema.parse(prior);
        }
        await requireAvailable(deps, actor, projectId, versionId, s);
        const at = deps.clock.now().toISOString(), id = newResourceId();
        const budget = 4200 + revision.initializer.steps.reduce((n, s) => n + s.timeoutSeconds, 0) + revision.tools.reduce((n, s) => n + s.timeoutSeconds, 0);
        const record: ImageValidation = { deadline: new Date(Date.parse(at) + budget * 1000).toISOString(), id, projectId, versionId, target: parsed.target, contractDigest, ...(initializerSecretVersions.length ? { initializerSecretVersions } : {}), state: 'queued', requestKey: parsed.requestKey, inputDigest, epoch: 0, createdBy: actor.userId, createdAt: at, updatedAt: at, checks: [] };
        await s.validations.insert(record);
        await s.references.insert({ id: newResourceId(), projectId, versionId, ownerType: 'validation', ownerId: id, state: 'confirmed', expiresAt: null, createdAt: at, snapshot: { versionId, image: `${version.repository}@${version.digest}`, digest: version.digest, architecture: version.architecture, validationId: id, initializerDigest: version.initializerDigest, initializer: revision.initializer, tools: revision.tools, ...(initializerSecretVersions.length ? { initializerSecretVersions } : {}), selectionSource: 'request' } });
        return RuntimeImageValidationDtoSchema.parse(record);
      });
    },
    cancelValidation: async (actor: Actor, projectId: string, versionId: string, validationId: string, requestKey: string) => {
      CancelRuntimeImageOperationSchema.parse({ requestKey });
      await deps.authorizer.authorize(actor, projectId, 'develop');
      await versionAccess(deps, actor, projectId, versionId);
      return deps.uow.run(async (s) => {
        const record = await s.validations.get(validationId, true);
        if (!record || record.versionId !== versionId || record.projectId !== projectId) throw notFound('镜像用途验证', validationId);
        if (record.cancelRequestKey && record.cancelRequestKey !== requestKey) throw conflict('验证已由其他取消请求处理');
        if (!['queued', 'running', 'cancelling'].includes(record.state)) return RuntimeImageValidationDtoSchema.parse(record);
        const next = { ...record, state: 'cancelling' as const, cancelRequestKey: requestKey, updatedAt: deps.clock.now().toISOString() };
        await s.validations.update(next); return RuntimeImageValidationDtoSchema.parse(next);
      });
    },
    getValidation: async (actor: Actor, projectId: string, versionId: string, validationId: string) => {
      await deps.authorizer.authorize(actor, projectId, 'develop');
      await versionAccess(deps, actor, projectId, versionId);
      const result = await deps.uow.read.validations.get(validationId);
      if (!result || result.versionId !== versionId || result.projectId !== projectId) throw notFound('镜像用途验证', validationId);
      return RuntimeImageValidationDtoSchema.parse(result);
    },
    listValidations: async (actor: Actor, projectId: string, versionId: string) => {
      await deps.authorizer.authorize(actor, projectId, 'develop');
      await versionAccess(deps, actor, projectId, versionId);
      return (await deps.uow.read.validations.list(versionId)).filter((v) => v.projectId === projectId).map((v) => RuntimeImageValidationDtoSchema.parse(v));
    },
  };
}
