import type { Actor, DataResourceDto } from '@crewstation/contracts';
import { conflict, forbidden, notFound } from '@crewstation/kernel';
import type { DataUseCaseDeps } from './dependencies';
import { toDto } from './serviceData';

/** I31：仅管理员手动轮换；空闲与并发启动检查由组合端口在同一项目锁下完成。 */
export function rotateCredentialUseCase(deps: DataUseCaseDeps) {
  return async (actor: Actor, id: string): Promise<DataResourceDto> => {
    if (!actor.isAdmin) throw forbidden('只有管理员可以轮换数据库口令');
    const resource = await deps.resources.getById(id);
    if (!resource) throw notFound('数据资源', id);
    if (resource.kind !== 'postgres' || resource.state !== 'ready') throw conflict('只有已就绪的 PostgreSQL 数据库可以轮换口令');
    const rotate = deps.provisioning?.credentials.rotateCredential;
    if (!rotate) throw conflict('平台尚未启用数据面口令轮换');
    await rotate(resource.id, resource.projectId);
    deps.logger.info('database credential rotated', { resourceId: id, projectId: resource.projectId, by: actor.userId });
    return toDto(resource);
  };
}
