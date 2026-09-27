import type { Actor } from '@crewstation/contracts';
import { notFound } from '@crewstation/kernel';
import type { RuntimeImage } from '../domain/records';
import type { RepositoryScope } from '../ports/unitOfWork';
import type { RuntimeImageDeps } from './dependencies';

/** 项目路径不构成授权；共享只放开读取，写入仍必须在所属项目。 */
export async function imageAccess(deps: RuntimeImageDeps, actor: Actor, projectId: string, imageId: string, action: 'view' | 'develop' | 'manage', scope: RepositoryScope = deps.uow.read, lock = false): Promise<RuntimeImage> {
  await deps.authorizer.authorize(actor, projectId, action);
  const image = await scope.images.get(imageId, lock);
  if (!image || (image.projectId !== projectId && (action !== 'view' || image.scope !== 'shared'))) throw notFound('运行镜像', imageId);
  return image;
}
