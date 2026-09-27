import type { Actor } from '@crewstation/contracts';
import { forbidden, notFound } from '@crewstation/kernel';
import type { RuntimeImage } from '../domain/records';
import type { RepositoryScope } from '../ports/unitOfWork';
import type { RuntimeImageDeps } from './dependencies';

export function catalogAdmin(actor: Actor): void {
  if (!actor.isAdmin) throw forbidden('运行镜像由平台管理员统一管理，业务只能使用获授权的镜像');
}

/** 没有业务上下文的入口只供平台管理；业务路径始终校验本业务的有效授权。 */
export async function imageAccess(deps: RuntimeImageDeps, actor: Actor, projectId: string | undefined, imageId: string, action: 'view' | 'develop' | 'manage', scope: RepositoryScope = deps.uow.read, lock = false): Promise<RuntimeImage> {
  if (action !== 'view' || projectId === undefined) catalogAdmin(actor);
  if (projectId !== undefined) await deps.authorizer.authorize(actor, projectId, 'view');
  const image = await scope.images.get(imageId, lock);
  if (!image) throw notFound('运行镜像', imageId);
  if (projectId === undefined || action !== 'view') return image;
  const policy = action === 'view' ? (await scope.projectImagePolicies.get(projectId))?.policy : undefined;
  const visible = policy?.mode === 'restricted' ? policy.allowedImageIds.includes(imageId) : image.defaultVisible || await scope.images.granted(imageId, projectId);
  if (!visible) throw notFound('运行镜像', imageId);
  return image;
}
