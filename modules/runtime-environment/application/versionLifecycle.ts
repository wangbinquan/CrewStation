import type { Actor } from '@crewstation/contracts';
import { conflict } from '@crewstation/kernel';
import type { ImageReferenceView } from '../api/bindings';
import type { RuntimeImageDeps } from './dependencies';
import { imageAccess } from './access';
import { versionAccess, versionLock } from './compatibility';

export function runtimeImageVersionLifecycle(deps: RuntimeImageDeps) {
  return {
    getVersion: async (actor: Actor, projectId: string, versionId: string) => (await versionAccess(deps, actor, projectId, versionId)).version,
    disableVersion: async (actor: Actor, projectId: string, versionId: string) => {
      const { version } = await versionAccess(deps, actor, projectId, versionId);
      await imageAccess(deps, actor, projectId, version.imageId, 'manage');
      return deps.uow.run(async (s) => {
        await s.lock(versionLock(version));
        const current = (await s.versions.get(versionId))!;
        if (current.state !== 'available') return current;
        const next = { ...current, state: 'disabled' as const };
        await s.versions.update(next); return next;
      });
    },
    versionReferences: async (actor: Actor, projectId: string, versionId: string) => {
      await versionAccess(deps, actor, projectId, versionId);
      await deps.authorizer.authorize(actor, projectId, 'develop');
      const refs = await deps.uow.read.references.list(versionId);
      const visible: ImageReferenceView[] = refs.filter((ref) => actor.isAdmin || ref.projectId === projectId).map(({ snapshot: _snapshot, snapshotInputDigest: _input, ...ref }) => ref);
      return { items: visible, total: refs.length };
    },
    retireVersion: async (actor: Actor, projectId: string, versionId: string) => {
      const { version } = await versionAccess(deps, actor, projectId, versionId);
      await imageAccess(deps, actor, projectId, version.imageId, 'manage');
      return deps.uow.run(async (s) => {
        await s.lock(versionLock(version));
        const current = (await s.versions.get(versionId))!;
        if (current.state === 'available') throw conflict('请先停用版本再删除');
        // 过期 reservation 也仍阻挡删除，须调用方确认没有已提交快照后释放。
        if ((await s.references.list(versionId)).length) throw conflict('镜像仍被发布、任务或恢复会话引用', { code: 'image_in_use' });
        const next = { ...current, state: 'retired' as const };
        await s.versions.update(next);
        const siblings = (await s.versions.byDigest(version.repository, version.digest)).filter((v) => v.id !== versionId && v.state !== 'retired');
        // 仓库 blob 物理回收独立进行；这里不伪报已释放磁盘空间。
        return { version: next, physicalDeletion: siblings.length ? 'retained' as const : 'pending-maintenance' as const };
      });
    },
  };
}
