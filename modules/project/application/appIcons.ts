import type { Actor, ProjectId, SetAppPresentationRequest } from '@crewstation/contracts';
import { SetAppPresentationRequestSchema } from '@crewstation/contracts';
import { conflict, notFound, validation } from '@crewstation/kernel';
import { authorizationUseCases } from './authorization';
import { currentActor } from './creation/eligibility';
import type { ProjectUseCaseDeps } from './dependencies';

export function appIconUseCases(deps: ProjectUseCaseDeps) {
  const { authorize } = authorizationUseCases(deps), { uow, iconDecoder, clock } = deps;
  return {
    uploadAppIcon: async (actor: Actor, projectId: ProjectId, raw: SetAppPresentationRequest, bytes: Uint8Array) => {
      await authorize(actor, projectId, 'manage-members');
      if ((await uow.read.projects.getById(projectId))?.kind !== 'DigitalWorker') throw notFound('应用', projectId);
      const parsed = SetAppPresentationRequestSchema.safeParse(raw);
      if (!parsed.success || parsed.data.iconSource) throw validation('请检查图标展示资料');
      const input = parsed.data, image = await iconDecoder.normalize(bytes);
      return uow.run(async (scope) => {
        const current = await scope.appListings.get(projectId);
        const iconSource = { kind: 'upload' as const, revision: input.expectedRevision + 1 };
        const saved = await scope.appListings.save({ ...current, description: input.description, icon: input.icon, iconSource, updatedAt: clock.now() }, input.expectedRevision);
        if (!saved) throw conflict('应用设置已由其他人更新；请保留草稿并读取最新设置后重试');
        await scope.appIcons.put(projectId, image);
        return { description: saved.description, icon: saved.icon, iconSource, revision: saved.revision, updatedAt: saved.updatedAt!.toISOString() };
      });
    },
    getAppIcon: async (actor: Actor, projectId: ProjectId) => {
      actor = await currentActor(deps, actor);
      const visible = (await uow.read.appListings.visible(actor, { projectId, q: '', limit: 1 }))[0];
      if (!visible || visible.listing.iconSource?.kind !== 'upload') throw notFound('应用图标', projectId);
      const image = await uow.read.appIcons.get(projectId);
      if (!image) throw notFound('应用图标', projectId);
      return image;
    },
  };
}
