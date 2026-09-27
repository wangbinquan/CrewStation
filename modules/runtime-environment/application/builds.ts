import type { Actor, RuntimeImageLogQuery, RuntimeImagePageQuery, StartRuntimeImageBuild } from '@crewstation/contracts';
import { CancelRuntimeImageOperationSchema, RuntimeImageBuildDtoSchema, RuntimeImageLogQuerySchema, RuntimeImagePageQuerySchema, StartRuntimeImageBuildSchema } from '@crewstation/contracts';
import { conflict, newResourceId, notFound, precondition, quotaExceeded } from '@crewstation/kernel';
import type { ImageBuild } from '../domain/records';
import { imageContentDigest } from '../domain/contentDigest';
import { transitionImageBuild } from '../domain/buildState';
import { imageAccess } from './access';
import type { RuntimeImageDeps } from './dependencies';

async function readBuild(deps: RuntimeImageDeps, actor: Actor, projectId: string | undefined, imageId: string, id: string): Promise<ImageBuild> {
  await imageAccess(deps, actor, projectId, imageId, 'develop');
  const build = await deps.uow.read.builds.get(id);
  if (!build || build.imageId !== imageId) throw notFound('镜像构建', id);
  return build;
}
export function runtimeImageBuilds(deps: RuntimeImageDeps) {
  return {
    startBuild: async (actor: Actor, projectId: string | undefined, imageId: string, input: StartRuntimeImageBuild) => {
      const parsed = StartRuntimeImageBuildSchema.parse(input), inputDigest = imageContentDigest({ revisionId: parsed.revisionId });
      await imageAccess(deps, actor, projectId, imageId, 'develop');
      return deps.uow.run(async (s) => {
        await s.lock('build-admission');
        const image = await imageAccess(deps, actor, projectId, imageId, 'develop', s, true);
        const previous = await s.builds.findRequest(imageId, actor.userId, parsed.requestKey);
        if (previous) {
          if (previous.inputDigest !== inputDigest) throw conflict('同一构建请求键不能选择不同修订', { code: 'idempotency_conflict' });
          return RuntimeImageBuildDtoSchema.parse(previous);
        }
        const revision = await s.revisions.get(parsed.revisionId);
        if (!revision || revision.imageId !== imageId) throw notFound('镜像修订', parsed.revisionId);
        if (!image.enabled) throw precondition('运行镜像已停用');
        if (deps.limits.platformBuilds < 1) throw precondition('平台未配置镜像构建容量', { code: 'image_build_unavailable' });
        if (await s.builds.activeCount() >= deps.limits.platformBuilds) throw quotaExceeded('镜像构建容量已满，请稍后重试', { code: 'image_build_capacity', retryAfter: 5 });
        const at = deps.clock.now(), last = (await s.builds.list(imageId, { limit: 1 }))[0];
        const build: ImageBuild = { id: newResourceId(), imageId, ...(revision.sourceProjectId ? { sourceProjectId: revision.sourceProjectId } : {}), revisionId: revision.id, state: 'queued', stage: 'queued', requestKey: parsed.requestKey, inputDigest, epoch: 0, executionEpoch: 1, ...(revision.source.kind !== 'existing' ? { resourceId: newResourceId() } : {}),
          createdBy: actor.userId, createdAt: at.toISOString(), updatedAt: at.toISOString(), deadline: new Date(at.getTime() + deps.limits.buildTimeoutSeconds * 1000).toISOString(), attempt: (last?.attempt ?? 0) + 1, unknown: false };
        await s.builds.insert(build); return RuntimeImageBuildDtoSchema.parse(build);
      });
    },
    getBuild: async (actor: Actor, projectId: string | undefined, imageId: string, buildId: string) => RuntimeImageBuildDtoSchema.parse(await readBuild(deps, actor, projectId, imageId, buildId)),
    listBuilds: async (actor: Actor, projectId: string | undefined, imageId: string, query: RuntimeImagePageQuery) => {
      await imageAccess(deps, actor, projectId, imageId, 'develop');
      return (await deps.uow.read.builds.list(imageId, RuntimeImagePageQuerySchema.parse(query))).map((b) => RuntimeImageBuildDtoSchema.parse(b));
    },
    cancelBuild: async (actor: Actor, projectId: string | undefined, imageId: string, buildId: string, requestKey: string) => {
      CancelRuntimeImageOperationSchema.parse({ requestKey });
      await readBuild(deps, actor, projectId, imageId, buildId);
      return deps.uow.run(async (s) => {
        const build = await s.builds.get(buildId, true);
        if (!build || build.imageId !== imageId) throw notFound('镜像构建', buildId);
        if (['cancelling', 'cancelled'].includes(build.state)) return RuntimeImageBuildDtoSchema.parse(build);
        if (['succeeded', 'failed'].includes(build.state)) throw conflict('构建已经结束', { code: 'image_build_terminal' });
        const { leaseOwner: _owner, leaseUntil: _until, ...rest } = build;
        const next = { ...rest, epoch: build.epoch + 1, state: transitionImageBuild(build.state, 'cancelling'), cancelRequestKey: requestKey, updatedAt: deps.clock.now().toISOString(), stage: 'stopping' };
        await s.builds.update(next); return RuntimeImageBuildDtoSchema.parse(next);
      });
    },
    buildLogs: async (actor: Actor, projectId: string | undefined, imageId: string, buildId: string, query: RuntimeImageLogQuery) => {
      const build = await readBuild(deps, actor, projectId, imageId, buildId), parsed = RuntimeImageLogQuerySchema.parse(query);
      const expiresAt = new Date(Date.parse(build.updatedAt) + deps.limits.logRetentionSeconds * 1000).toISOString();
      // 保留期只对已结束构建计时，活动构建不得因启动过早丢日志。
      const expired = ['succeeded', 'failed', 'cancelled'].includes(build.state) && expiresAt <= deps.clock.now().toISOString();
      if (expired) return { expired: true as const, expiresAt };
      const items = await deps.uow.read.logs.page(buildId, parsed.after, parsed.limit);
      return { expired: false as const, items, next: items.at(-1)?.sequence ?? parsed.after, truncated: await deps.uow.read.logs.bytes(buildId) >= deps.limits.logMaxBytes, expiresAt };
    },
  };
}
