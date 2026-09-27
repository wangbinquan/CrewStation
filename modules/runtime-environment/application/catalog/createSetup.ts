import type { Actor, CreateRuntimeImageSetup } from '@crewstation/contracts';
import { CreateRuntimeImageSetupSchema } from '@crewstation/contracts';
import { conflict, newResourceId, precondition } from '@crewstation/kernel';
import type { RuntimeImage, ImageRevision } from '../../domain/records';
import { imageContentDigest } from '../../domain/contentDigest';
import type { RuntimeImageDeps } from '../dependencies';

export function createRuntimeImageSetup(deps: RuntimeImageDeps) {
  return async (actor: Actor, projectId: string, input: CreateRuntimeImageSetup): Promise<{ image: RuntimeImage; revision: ImageRevision }> => {
    const parsed = CreateRuntimeImageSetupSchema.parse(input);
    await deps.authorizer.authorize(actor, projectId, 'develop');
    const fingerprint = imageContentDigest(parsed), old = await deps.uow.read.creations.get(projectId, actor.userId, parsed.requestKey);
    const replay = async (record: NonNullable<typeof old>) => {
      if (record.fingerprint !== fingerprint) throw conflict('新增请求的内容已改变，请为新镜像重新提交');
      const image = await deps.uow.read.images.get(record.imageId), revision = await deps.uow.read.revisions.get(record.revisionId);
      if (!image || !revision) throw precondition('新增镜像记录不完整');
      return { image, revision };
    };
    if (old) return replay(old);
    const prepared = await deps.sources.prepare(actor, projectId, parsed.recipe.source);
    if (prepared.source.kind === 'source' && (!prepared.commitSha || !/^[0-9a-f]{40,64}$/.test(prepared.commitSha))) throw precondition('源码未解析到固定提交');
    if (prepared.source.kind === 'existing' && !/@sha256:[0-9a-f]{64}$/.test(prepared.source.reference)) throw precondition('已有镜像未解析到固定摘要');
    const content = { ...prepared, initializer: parsed.recipe.initializer, tools: parsed.recipe.tools };
    return deps.uow.run(async (s) => {
      await s.lock(`create:${projectId}:${actor.userId}:${parsed.requestKey}`);
      await deps.authorizer.authorize(actor, projectId, 'develop');
      const current = await s.creations.get(projectId, actor.userId, parsed.requestKey);
      if (current) return replay(current);
      const at = deps.clock.now().toISOString(), image: RuntimeImage = { id: newResourceId(), projectId, name: parsed.name, description: parsed.description,
        scope: 'project', enabled: true, revision: 1, createdBy: actor.userId, createdAt: at, updatedAt: at };
      const revision: ImageRevision = { id: newResourceId(), imageId: image.id, revision: 1, ...content,
        recipeDigest: imageContentDigest(content), createdBy: actor.userId, createdAt: at };
      await s.images.insert(image); await s.revisions.insert(revision);
      await s.creations.insert({ projectId, actorId: actor.userId, requestKey: parsed.requestKey, fingerprint, imageId: image.id, revisionId: revision.id });
      return { image, revision };
    });
  };
}
