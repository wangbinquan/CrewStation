import type { Actor, RuntimeImageSelection, RuntimeImageValidationTarget, SaveDevelopmentRuntimeImages } from '@crewstation/contracts';
import { SaveDevelopmentRuntimeImagesSchema } from '@crewstation/contracts';
import { conflict, newResourceId, precondition } from '@crewstation/kernel';
import type { RuntimeImageDeps } from './dependencies';
import { compatibilityEvidence, requireAvailable, versionAccess, versionLock } from './compatibility';

const selectedIds = (selection: RuntimeImageSelection): string[] => [...new Set([selection.runtimeImageVersionId, ...(selection.allowedRuntimeImageVersionIds ?? [])].filter((id): id is string => !!id))];
const policyIds = (policy: Omit<SaveDevelopmentRuntimeImages, 'expectedRevision'>) => [...new Set([policy.developmentTask, ...policy.developmentAgents.map((a) => a.selection)].flatMap(selectedIds))];

export function developmentImagePolicy(deps: RuntimeImageDeps) {
  const get = async (actor: Actor, projectId: string) => {
    await deps.authorizer.authorize(actor, projectId, 'view');
    return await deps.uow.read.developmentPolicies.get(projectId) ?? { projectId, revision: 0, developmentTask: {}, developmentAgents: [] };
  };
  return {
    getDevelopmentImages: get,
    saveDevelopmentImages: async (actor: Actor, projectId: string, input: SaveDevelopmentRuntimeImages) => {
      await deps.authorizer.authorize(actor, projectId, 'develop');
      const parsed = SaveDevelopmentRuntimeImagesSchema.parse(input);
      const targets: Array<{ selection: RuntimeImageSelection; target: RuntimeImageValidationTarget }> = [{ selection: parsed.developmentTask, target: { usage: 'task' } }];
      for (const agent of parsed.developmentAgents) {
        if (!deps.validationContracts.profileRevision) throw precondition('Agent 档位授权端口尚未配置');
        targets.push({ selection: agent.selection, target: { usage: 'agent', profile: await deps.validationContracts.profileRevision(actor, projectId, agent.profileId) } });
      }
      const evidence: Array<{ version: Awaited<ReturnType<typeof versionAccess>>['version']; contractDigest: string }> = [];
      for (const { selection, target } of targets) for (const id of selectedIds(selection)) {
        const { version, revision } = await versionAccess(deps, actor, projectId, id);
        evidence.push({ version, ...(await compatibilityEvidence(deps, actor, projectId, version, revision, target)) });
      }
      return deps.uow.run(async (s) => {
        await s.lock(`development-policy:${projectId}`);
        const old = await s.developmentPolicies.get(projectId);
        if ((old?.revision ?? 0) !== parsed.expectedRevision) throw conflict('开发运行镜像配置已变化，请重新读取');
        const next = { projectId, revision: parsed.expectedRevision + 1, developmentTask: parsed.developmentTask, developmentAgents: parsed.developmentAgents };
        const ids = [...new Set([...policyIds(next), ...(old ? policyIds(old) : [])])];
        const versions = await Promise.all(ids.map((id) => s.versions.get(id)));
        for (const lock of [...new Set(versions.filter((v) => !!v).map(versionLock))].sort()) await s.lock(lock);
        for (const { version, contractDigest } of evidence) {
          await requireAvailable(deps, actor, projectId, version.id, s);
          if (!await s.validations.findPassed(version.id, contractDigest)) throw precondition('开发默认和允许集合中的镜像必须先通过对应用途验证', { code: 'image_usage_unvalidated', imageVersionId: version.id });
        }
        const retained = new Set(policyIds(next));
        for (const id of ids) {
          const ref = await s.references.get(id, 'development-config', projectId);
          if (!retained.has(id)) { if (ref) await s.references.remove(ref.id); }
          else if (!ref) await s.references.insert({ id: newResourceId(), projectId, versionId: id, ownerType: 'development-config', ownerId: projectId, state: 'confirmed', expiresAt: null, createdAt: deps.clock.now().toISOString() });
        }
        await s.developmentPolicies.save(next);
        return next;
      });
    },
  };
}
