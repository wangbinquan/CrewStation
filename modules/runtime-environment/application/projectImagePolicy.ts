import type { Actor, ProjectRuntimeImagePolicyDto, SaveProjectRuntimeImagePolicy } from '@crewstation/contracts';
import { ProjectRuntimeImagePolicyDtoSchema, SaveProjectRuntimeImagePolicySchema } from '@crewstation/contracts';
import { conflict, forbidden, validation } from '@crewstation/kernel';
import type { RuntimeImageDeps } from './dependencies';
import { imageAccess } from './access';

export function projectImagePolicy(deps: RuntimeImageDeps) {
  const getProjectImagePolicy = async (actor: Actor, projectId: string): Promise<ProjectRuntimeImagePolicyDto> => {
    await deps.authorizer.authorize(actor, projectId, 'view');
    return await deps.uow.read.projectImagePolicies.get(projectId) ?? ProjectRuntimeImagePolicyDtoSchema.parse({ projectId, revision: 0, policy: { mode: 'inherit', allowedImageIds: [] }, updatedAt: null });
  };
  return {
    imageGrants: async (actor: Actor, imageId: string) => {
      const image = await imageAccess(deps, actor, undefined, imageId, 'view');
      return { defaultVisible: image.defaultVisible, ...await deps.uow.read.images.grants(imageId) };
    },
    getProjectImagePolicy,
    saveProjectImagePolicy: async (actor: Actor, projectId: string, input: SaveProjectRuntimeImagePolicy): Promise<ProjectRuntimeImagePolicyDto> => {
      if (!actor.isAdmin) throw forbidden('只有平台管理员可以配置业务镜像授权');
      await deps.authorizer.authorize(actor, projectId, 'view');
      const parsed = SaveProjectRuntimeImagePolicySchema.parse(input);
      return deps.uow.run(async (s) => {
        await s.lock(`image-policy:${projectId}`);
        const old = await s.projectImagePolicies.get(projectId);
        if ((old?.revision ?? 0) !== parsed.expectedRevision) throw conflict('业务镜像授权已被修改，请重新读取后核对；本次修改未保存', { code: 'project_image_policy_revision_conflict' });
        for (const id of parsed.policy.allowedImageIds) if (!await s.images.get(id)) throw validation('授权镜像不存在，请刷新目录', { field: 'allowedImageIds', imageId: id });
        const next = ProjectRuntimeImagePolicyDtoSchema.parse({ projectId, revision: parsed.expectedRevision + 1, policy: parsed.policy, updatedAt: deps.clock.now().toISOString() });
        await s.projectImagePolicies.save(next);
        return next;
      });
    },
  };
}
