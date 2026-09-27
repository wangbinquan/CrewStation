import type { Actor, CreateRuntimeImageRequest, UpdateRuntimeImageRequest, CreateRuntimeImageRevision, RuntimeImagePageQuery } from '@crewstation/contracts';
import { CreateRuntimeImageRequestSchema, CreateRuntimeImageRevisionSchema, RuntimeImagePageQuerySchema, UpdateRuntimeImageRequestSchema } from '@crewstation/contracts';
import { conflict, forbidden, newResourceId, precondition, validation } from '@crewstation/kernel';
import type { ImageRevision, RuntimeImage } from '../domain/records';
import { imageContentDigest } from '../domain/contentDigest';
import type { RuntimeImageDeps } from './dependencies';
import { imageAccess } from './access';

export function runtimeImageCatalog(deps: RuntimeImageDeps) {
  return {
    adminCatalog: async (actor: Actor, query: RuntimeImagePageQuery) => {
      if (!actor.isAdmin) throw forbidden('只有管理员可以管理公共镜像目录');
      return deps.uow.read.images.listAll(RuntimeImagePageQuerySchema.parse(query));
    },
    listImages: async (actor: Actor, projectId: string, query: RuntimeImagePageQuery) => {
      await deps.authorizer.authorize(actor, projectId, 'view');
      return deps.uow.read.images.list(projectId, RuntimeImagePageQuerySchema.parse(query), true);
    },
    getImage: (actor: Actor, projectId: string, id: string) => imageAccess(deps, actor, projectId, id, 'view'),
    createImage: async (actor: Actor, projectId: string, input: CreateRuntimeImageRequest): Promise<RuntimeImage> => {
      const parsed = CreateRuntimeImageRequestSchema.parse(input);
      await deps.authorizer.authorize(actor, projectId, 'develop');
      const at = deps.clock.now().toISOString();
      const image: RuntimeImage = { id: newResourceId(), projectId, ...parsed, scope: 'project', enabled: true, revision: 1, createdBy: actor.userId, createdAt: at, updatedAt: at };
      await deps.uow.run((s) => s.images.insert(image));
      return image;
    },
    updateImage: async (actor: Actor, projectId: string, id: string, input: UpdateRuntimeImageRequest) => {
      const parsed = UpdateRuntimeImageRequestSchema.parse(input);
      return deps.uow.run(async (s) => {
        const old = await imageAccess(deps, actor, projectId, id, parsed.enabled === false ? 'manage' : 'develop', s, true);
        if (old.revision !== parsed.expectedRevision) throw conflict('运行镜像已被修改，请刷新', { code: 'image_revision_conflict' });
        const next = { ...old, ...(parsed.name === undefined ? {} : { name: parsed.name }), ...(parsed.description === undefined ? {} : { description: parsed.description }), ...(parsed.enabled === undefined ? {} : { enabled: parsed.enabled }), revision: old.revision + 1, updatedAt: deps.clock.now().toISOString() };
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
        const next = { ...old, scope, revision: old.revision + 1, updatedAt: deps.clock.now().toISOString() };
        await s.images.update(next); return next;
      });
    },
    createRevision: async (actor: Actor, projectId: string, imageId: string, input: CreateRuntimeImageRevision): Promise<ImageRevision> => {
      const parsed = CreateRuntimeImageRevisionSchema.parse(input);
      await imageAccess(deps, actor, projectId, imageId, 'develop');
      const prepared = await deps.sources.prepare(actor, projectId, parsed.source);
      if (prepared.source.kind === 'source' && (!prepared.commitSha || !/^[0-9a-f]{40,64}$/.test(prepared.commitSha))) throw precondition('源码未解析到固定提交', { code: 'image_source_not_pinned' });
      if (prepared.source.kind === 'existing' && !/@sha256:[0-9a-f]{64}$/.test(prepared.source.reference)) throw precondition('已有镜像未解析到固定摘要', { code: 'image_source_not_pinned' });
      const content = { source: prepared.source, ...(prepared.commitSha ? { commitSha: prepared.commitSha } : {}), ...(prepared.baseImage ? { baseImage: prepared.baseImage } : {}), initializer: parsed.initializer, tools: parsed.tools };
      return deps.uow.run(async (s) => {
        const image = await imageAccess(deps, actor, projectId, imageId, 'develop', s, true);
        if (!image.enabled) throw precondition('运行镜像已停用');
        const revision: ImageRevision = { id: newResourceId(), imageId, revision: await s.revisions.next(imageId), ...content, recipeDigest: imageContentDigest(content), createdBy: actor.userId, createdAt: deps.clock.now().toISOString() };
        await s.revisions.insert(revision); return revision;
      });
    },
    listRevisions: async (actor: Actor, projectId: string, imageId: string, query: RuntimeImagePageQuery) => {
      // 源码与 Secret 引用不是公共镜像目录的投影；只向所属项目开发者提供。
      await imageAccess(deps, actor, projectId, imageId, 'develop');
      return deps.uow.read.revisions.list(imageId, RuntimeImagePageQuerySchema.parse(query));
    },
    listVersions: async (actor: Actor, projectId: string, imageId: string, query: RuntimeImagePageQuery) => {
      await imageAccess(deps, actor, projectId, imageId, 'view');
      return deps.uow.read.versions.list(imageId, RuntimeImagePageQuerySchema.parse(query));
    },
  };
}
