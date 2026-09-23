import type { Manifest } from '@crewstation/contracts';
import { DomainTopic } from '@crewstation/contracts';
import { reasonText } from '../domain/precheck';
import type { Release } from '../domain/release';
import { advance } from '../domain/release';
import { startRetention } from '../domain/slotLifecycle';
import { withSlot } from '../domain/slots';
import type { ReleaseUseCaseDeps } from './dependencies';
import type { PipelineContext, ResolvedService, StepResult } from './pipelineContext';
import { DONE, WAIT } from './pipelineContext';
import { prepareSlotDeploy } from './deployPrecheck';

export interface DeploySteps {
  startDeploy(release: Release, svc: ResolvedService, manifest: Manifest): Promise<StepResult>;
  pollMigration(release: Release, svc: ResolvedService): Promise<StepResult>;
  pollDeploy(release: Release, svc: ResolvedService): Promise<StepResult>;
}

/** 部署阶段：待命槽换上新发布并标记旧发布 superseded；就绪后登记 Manifest 与 OpenAPI。 */
export function deploySteps(deps: ReleaseUseCaseDeps, ctx: PipelineContext): DeploySteps {
  const { uow, clock } = deps;

  const startDeploy: DeploySteps['startDeploy'] = async (release, svc, manifest) => {
    const prepared = await prepareSlotDeploy(deps, release, svc, manifest, release.targetSlot);
    if ('reason' in prepared) return ctx.fail(release, reasonText(prepared.reason));
    const { plan, replicas, env } = prepared;
    await deps.deployer.deploy({ namespace: svc.namespace, projectSlug: svc.slug, serviceName: svc.name, physical: release.targetSlot, releaseId: release.id, image: release.image ?? '', manifest, replicas, env: env.values, plan });
    const now = clock.now();
    await uow.run(async (scope) => {
      const slots = await scope.slots.get(release.serviceId);
      if (!slots) return;
      const previous = slots[release.targetSlot].releaseId;
      if (previous && previous !== release.id) {
        const old = await scope.releases.getById(previous);
        if (old?.status === 'ready') await scope.releases.update(advance(old, 'superseded', now));
      }
      await scope.slots.save(withSlot(slots, { physical: release.targetSlot, releaseId: release.id, state: 'deploying', replicas, readyReplicas: 0, updatedAt: now }, now));
    });
    await ctx.save(release, 'deploying', { manifest, configVersion: env.configVersion, pipeline: { ...release.pipeline, deployStartedAt: now.toISOString() } });
    return WAIT;
  };

  const registerReady = async (release: Release, status: { replicas: number; readyReplicas: number }): Promise<void> => {
    const now = clock.now();
    const exposes = release.manifest && release.manifest.kind !== 'EventProducer' ? release.manifest.spec.apis.exposes : undefined;
    const openapi = exposes ? await deps.repo.readFile(release.serviceId, release.tag, exposes.openapi.replace(/^\.\//, '')) : undefined;
    await uow.run(async (scope) => {
      const slots = await scope.slots.get(release.serviceId);
      // 待命槽就绪即开始「无人访问」计时（RFC-021 M2）；正式槽不计时。
      const retention = slots && slots.active !== release.targetSlot ? { retention: startRetention('pending', now) } : {};
      if (slots) await scope.slots.save(withSlot(slots, { ...slots[release.targetSlot], state: 'ready', replicas: status.replicas, readyReplicas: status.readyReplicas, updatedAt: now, ...retention }, now));
      await scope.events.publish(DomainTopic.releaseRegistered, {
        occurredAt: now.toISOString(), projectId: release.projectId, serviceId: release.serviceId, releaseId: release.id, tag: release.tag, commitSha: release.commitSha,
        manifest: release.manifest as Manifest, ...(openapi ? { openapiDocument: Bun.YAML.parse(openapi) } : {}),
      });
    });
  };

  return {
    startDeploy,
    pollMigration: async (release, svc) => {
      const status = await deps.migrator.status(release.pipeline.migrationRef ?? '', svc.namespace);
      if (status.state === 'running') { await ctx.bump(release); return WAIT; }
      if (status.state === 'failed') return ctx.fail(release, `迁移失败，未切流：${status.message}`);
      return release.manifest ? startDeploy(release, svc, release.manifest) : ctx.fail(release, 'Manifest 丢失');
    },
    pollDeploy: async (release, svc) => {
      const status = await deps.deployer.status(svc.namespace, svc.name, release.targetSlot);
      const startedAt = release.pipeline.deployStartedAt ? new Date(release.pipeline.deployStartedAt).getTime() : clock.now().getTime();
      if (status.state === 'failed' || status.state === 'degraded') return ctx.fail(release, `待命槽部署失败：${status.message ?? status.state}`);
      if (status.state === 'deploying') {
        if (clock.now().getTime() - startedAt > deps.settings.deployTimeoutSeconds * 1000) return ctx.fail(release, '待命槽部署超时');
        await ctx.bump(release);
        return WAIT;
      }
      await registerReady(release, status);
      // 首次就绪的时刻：只有就绪过的版本才能从发布记录重新部署（RFC-021 §4）。
      await ctx.save(release, 'ready', { pipeline: { ...release.pipeline, readyAt: release.pipeline.readyAt ?? clock.now().toISOString() } });
      return DONE;
    },
  };
}
