import type { Actor, CreateRuntimeImageSetup } from '@crewstation/contracts';
import { CreateRuntimeImageSetupSchema } from '@crewstation/contracts';
import { conflict, newResourceId, precondition } from '@crewstation/kernel';
import type { RuntimeImage, ImageRevision } from '../../domain/records';
import { imageContentDigest } from '../../domain/contentDigest';
import type { RuntimeImageDeps } from '../dependencies';
import { catalogAdmin } from '../access';
import { prepareRecipe } from './prepareRecipe';

export function createRuntimeImageSetup(deps: RuntimeImageDeps) {
  return async (actor: Actor, projectId: string | undefined, input: CreateRuntimeImageSetup): Promise<{ image: RuntimeImage; revision: ImageRevision }> => {
    catalogAdmin(actor);
    const parsed = CreateRuntimeImageSetupSchema.parse(input);
    if (projectId) await deps.authorizer.authorize(actor, projectId, 'view');
    const requestScope = projectId ?? 'platform';
    const fingerprint = imageContentDigest(parsed), old = await deps.uow.read.creations.get(requestScope, actor.userId, parsed.requestKey);
    const replay = async (record: NonNullable<typeof old>) => {
      if (record.fingerprint !== fingerprint) throw conflict('新增请求的内容已改变，请为新镜像重新提交');
      const image = await deps.uow.read.images.get(record.imageId), revision = await deps.uow.read.revisions.get(record.revisionId);
      if (!image || !revision) throw precondition('新增镜像记录不完整');
      return { image, revision };
    };
    if (old) return replay(old);
    const content = await prepareRecipe(deps, actor, projectId, parsed.recipe);
    return deps.uow.run(async (s) => {
      await s.lock(`create:${requestScope}:${actor.userId}:${parsed.requestKey}`);
      catalogAdmin(actor);
      if (projectId) await deps.authorizer.authorize(actor, projectId, 'view');
      const current = await s.creations.get(requestScope, actor.userId, parsed.requestKey);
      if (current) return replay(current);
      const at = deps.clock.now().toISOString(), image: RuntimeImage = { id: newResourceId(), name: parsed.name, description: parsed.description,
        defaultVisible: parsed.defaultVisible ?? false, enabled: true, revision: 1, createdBy: actor.userId, createdAt: at, updatedAt: at };
      const revision: ImageRevision = { id: newResourceId(), imageId: image.id, revision: 1, ...content,
        recipeDigest: imageContentDigest(content), createdBy: actor.userId, createdAt: at };
      await s.images.insert(image); await s.revisions.insert(revision);
      if (projectId) await s.images.grant(image.id, projectId);
      await s.creations.insert({ projectId: requestScope, actorId: actor.userId, requestKey: parsed.requestKey, fingerprint, imageId: image.id, revisionId: revision.id });
      return { image, revision };
    });
  };
}
