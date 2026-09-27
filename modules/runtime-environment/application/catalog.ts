import type { Actor, CreateRuntimeImageRequest, UpdateRuntimeImageRequest, CreateRuntimeImageRevision, RuntimeImagePageQuery } from '@crewstation/contracts';
import { CreateRuntimeImageRequestSchema, CreateRuntimeImageRevisionSchema, RuntimeImagePageQuerySchema, UpdateRuntimeImageRequestSchema } from '@crewstation/contracts';
import { conflict, forbidden, newResourceId, precondition, validation } from '@crewstation/kernel';
import type { ImageRevision, RuntimeImage } from '../domain/records';
import { imageContentDigest } from '../domain/contentDigest';
import type { RuntimeImageDeps } from './dependencies';
import { catalogAdmin, imageAccess } from './access';
import { prepareRecipe } from './catalog/prepareRecipe';

export function runtimeImageCatalog(deps: RuntimeImageDeps) {
  return {
    adminCatalog: async (actor: Actor, query: RuntimeImagePageQuery) => {
      if (!actor.isAdmin) throw forbidden('只有管理员可以管理公共镜像目录');
      return deps.uow.read.images.listAll(RuntimeImagePageQuerySchema.parse(query));
    },
    listImages: async (actor: Actor, projectId: string, query: RuntimeImagePageQuery) => {
      await deps.authorizer.authorize(actor, projectId, 'view');
      return deps.uow.read.images.list(projectId, RuntimeImagePageQuerySchema.parse(query), true, (await deps.uow.read.projectImagePolicies.get(projectId))?.policy);
    },
    getImage: (actor: Actor, projectId: string | undefined, id: string) => imageAccess(deps, actor, projectId, id, 'view'),
    createImage: async (actor: Actor, projectId: string | undefined, input: CreateRuntimeImageRequest): Promise<RuntimeImage> => {
      catalogAdmin(actor);
      const parsed = CreateRuntimeImageRequestSchema.parse(input);
      if (projectId) await deps.authorizer.authorize(actor, projectId, 'view');
      const at = deps.clock.now().toISOString();
      const image: RuntimeImage = { id: newResourceId(), ...parsed, defaultVisible: parsed.defaultVisible ?? false, enabled: true, revision: 1, createdBy: actor.userId, createdAt: at, updatedAt: at };
      await deps.uow.run(async (s) => { await s.images.insert(image); if (projectId) await s.images.grant(image.id, projectId); });
      return image;
    },
    updateImage: async (actor: Actor, projectId: string | undefined, id: string, input: UpdateRuntimeImageRequest) => {
      const parsed = UpdateRuntimeImageRequestSchema.parse(input);
      return deps.uow.run(async (s) => {
        const old = await imageAccess(deps, actor, projectId, id, parsed.enabled === false ? 'manage' : 'develop', s, true);
        if (old.revision !== parsed.expectedRevision) throw conflict('运行镜像已被修改，请刷新', { code: 'image_revision_conflict' });
        const next = { ...old, ...(parsed.name === undefined ? {} : { name: parsed.name }), ...(parsed.description === undefined ? {} : { description: parsed.description }), ...(parsed.enabled === undefined ? {} : { enabled: parsed.enabled }), ...(parsed.defaultVisible === undefined ? {} : { defaultVisible: parsed.defaultVisible }), revision: old.revision + 1, updatedAt: deps.clock.now().toISOString() };
        await s.images.update(next);
        return next;
      });
    },
    shareImage: async (actor: Actor, projectId: string, id: string, scope: 'project' | 'shared', expectedRevision: number) => {
      if (!actor.isAdmin) throw forbidden('只有平台管理员可以设置公共镜像');
      if (!['project', 'shared'].includes(scope)) throw validation('镜像可见范围不合法');
      return deps.uow.run(async (s) => {
        const old = await imageAccess(deps, actor, projectId, id, 'manage', s, true);
        if (old.revision !== expectedRevision) throw conflict('运行镜像已被修改，请刷新');
        const next = { ...old, defaultVisible: scope === 'shared', revision: old.revision + 1, updatedAt: deps.clock.now().toISOString() };
        await s.images.update(next); return next;
      });
    },
    createRevision: async (actor: Actor, projectId: string | undefined, imageId: string, input: CreateRuntimeImageRevision): Promise<ImageRevision> => {
      const parsed = CreateRuntimeImageRevisionSchema.parse(input);
      await imageAccess(deps, actor, projectId, imageId, 'develop');
      const content = await prepareRecipe(deps, actor, projectId, parsed);
      return deps.uow.run(async (s) => {
        const image = await imageAccess(deps, actor, projectId, imageId, 'develop', s, true);
        if (!image.enabled) throw precondition('运行镜像已停用');
        const revision: ImageRevision = { id: newResourceId(), imageId, revision: await s.revisions.next(imageId), ...content, recipeDigest: imageContentDigest(content), createdBy: actor.userId, createdAt: deps.clock.now().toISOString() };
        await s.revisions.insert(revision); return revision;
      });
    },
    listRevisions: async (actor: Actor, projectId: string | undefined, imageId: string, query: RuntimeImagePageQuery) => {
      // 来源与构建凭据不随使用授权开放，只供平台管理。
      await imageAccess(deps, actor, projectId, imageId, 'develop');
      return deps.uow.read.revisions.list(imageId, RuntimeImagePageQuerySchema.parse(query));
    },
    listVersions: async (actor: Actor, projectId: string | undefined, imageId: string, query: RuntimeImagePageQuery) => {
      await imageAccess(deps, actor, projectId, imageId, 'view');
      return deps.uow.read.versions.list(imageId, RuntimeImagePageQuerySchema.parse(query));
    },
  };
}
