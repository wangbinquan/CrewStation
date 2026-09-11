import type { Manifest, ReleaseId } from '@crewstation/contracts';
import { DomainTopic, ManifestSchema } from '@crewstation/contracts';
import { isPlatformError } from '@crewstation/kernel';
import { assertMigrationAllowed } from '../domain/migrationPolicy';
import type { Release } from '../domain/release';
import { advance, isInProgress } from '../domain/release';
import { withSlot } from '../domain/slots';
import type { ReleaseUseCaseDeps } from './dependencies';
import { renderSlotEnv } from './pipelineEnv';

export interface StepResult { done: boolean; retryAfterSeconds: number }
type Svc = NonNullable<Awaited<ReturnType<ReleaseUseCaseDeps['services']['resolveServiceById']>>>;
const WAIT: StepResult = { done: false, retryAfterSeconds: 5 };
const DONE: StepResult = { done: true, retryAfterSeconds: 0 };

/** 流水线的一步：按当前状态推进或轮询；每次调用都递增 step 并落库，供工作器用唯一键重新入队。 */
export function pipelineStepUseCase(deps: ReleaseUseCaseDeps) {
  const { uow, clock, logger } = deps;

  const save = async (release: Release, status: Release['status'], patch: Partial<Release> = {}, message?: string): Promise<Release> => {
    const now = clock.now();
    const next = advance(release, status, now, { ...patch, pipeline: { ...release.pipeline, ...(patch.pipeline ?? {}), step: release.pipeline.step + 1 }, ...(message ? { message } : {}) });
    await uow.run(async (scope) => {
      await scope.releases.update(next);
      if (status === 'failed' && release.status === 'deploying') {
        const slots = await scope.slots.get(release.serviceId);
        if (slots) await scope.slots.save(withSlot(slots, { ...slots[release.targetSlot], state: 'failed', updatedAt: now }, now));
      }
      await scope.events.publish(DomainTopic.releaseStatusChanged, { occurredAt: now.toISOString(), serviceId: release.serviceId, releaseId: release.id, status, ...(message ? { message } : {}) });
    });
    return next;
  };

  const fail = async (release: Release, message: string): Promise<StepResult> => {
    logger.warn('release failed', { releaseId: release.id, tag: release.tag, message });
    await save(release, 'failed', {}, message);
    return DONE;
  };

  const bump = async (release: Release): Promise<void> => {
    await uow.run((scope) => scope.releases.update({ ...release, pipeline: { ...release.pipeline, step: release.pipeline.step + 1 } }));
  };

  const startBuild = async (release: Release, svc: Svc): Promise<StepResult> => {
    const image = `${deps.settings.registryBase}/${svc.slug}:${release.tag}`;
    const { httpUrl, credentialSecretName } = await deps.repo.repositoryUrl(release.serviceId);
    const { buildRef } = await deps.builder.start({ releaseId: release.id, namespace: svc.namespace, repoHttpUrl: httpUrl, credentialSecretName, ref: release.tag, image });
    await save(release, 'building', { image, pipeline: { ...release.pipeline, buildRef } });
    return WAIT;
  };

  const loadManifest = async (release: Release): Promise<Manifest> => {
    const text = await deps.repo.readFile(release.serviceId, release.tag, 'crewstation.yaml');
    if (!text) throw new Error('仓库中没有 crewstation.yaml');
    return ManifestSchema.parse(Bun.YAML.parse(text));
  };

  const startDeploy = async (release: Release, svc: Svc, manifest: Manifest): Promise<StepResult> => {
    const plan = await deps.plans.getServicePlan(manifest.spec.service.plan);
    if (!plan) return fail(release, `服务套餐 ${manifest.spec.service.plan} 不存在`);
    if (manifest.spec.service.replicas > plan.maxReplicas) return fail(release, `副本数 ${manifest.spec.service.replicas} 超过套餐上限 ${plan.maxReplicas}`);
    const env = await renderSlotEnv(deps, { projectId: release.projectId, serviceId: release.serviceId, projectSlug: svc.slug, serviceName: svc.name, physical: release.targetSlot, manifest });
    await deps.deployer.deploy({ namespace: svc.namespace, projectSlug: svc.slug, serviceName: svc.name, physical: release.targetSlot, releaseId: release.id, image: release.image ?? '', manifest, env: env.values, plan });
    const now = clock.now();
    await uow.run(async (scope) => {
      const slots = await scope.slots.get(release.serviceId);
      if (!slots) return;
      const previous = slots[release.targetSlot].releaseId;
      if (previous && previous !== release.id) {
        const old = await scope.releases.getById(previous);
        if (old?.status === 'ready') await scope.releases.update(advance(old, 'superseded', now));
      }
      await scope.slots.save(withSlot(slots, { physical: release.targetSlot, releaseId: release.id, state: 'deploying', replicas: manifest.spec.service.replicas, readyReplicas: 0, updatedAt: now }, now));
    });
    await save(release, 'deploying', { manifest, configVersion: env.configVersion, pipeline: { ...release.pipeline, deployStartedAt: now.toISOString() } });
    return WAIT;
  };

  const afterBuild = async (release: Release, svc: Svc): Promise<StepResult> => {
    let manifest: Manifest;
    try {
      manifest = await loadManifest(release);
      assertMigrationAllowed(manifest.spec.release.migration, deps.settings.maintenanceWindow);
    } catch (error) {
      return fail(release, isPlatformError(error) ? error.message : `Manifest 无效：${String(error)}`);
    }
    const command = manifest.spec.release.migrationCommand;
    if (!command) return startDeploy(release, svc, manifest);
    const env = await renderSlotEnv(deps, { projectId: release.projectId, serviceId: release.serviceId, projectSlug: svc.slug, serviceName: svc.name, physical: release.targetSlot, manifest }).catch((error: unknown) => ({ error }));
    if ('error' in env) return fail(release, String((env.error as Error).message ?? env.error));
    const { migrationRef } = await deps.migrator.start({ releaseId: release.id, namespace: svc.namespace, image: release.image ?? '', command, env: env.values });
    await save(release, 'migrating', { manifest, configVersion: env.configVersion, pipeline: { ...release.pipeline, migrationRef } });
    return WAIT;
  };

  const pollBuild = async (release: Release, svc: Svc): Promise<StepResult> => {
    const status = await deps.builder.status(release.pipeline.buildRef ?? '', svc.namespace);
    if (status.state === 'running') { await bump(release); return WAIT; }
    if (status.state === 'failed') return fail(release, `构建失败：${status.message}`);
    return afterBuild(release, svc);
  };

  const pollMigration = async (release: Release, svc: Svc): Promise<StepResult> => {
    const status = await deps.migrator.status(release.pipeline.migrationRef ?? '', svc.namespace);
    if (status.state === 'running') { await bump(release); return WAIT; }
    if (status.state === 'failed') return fail(release, `迁移失败，未切流：${status.message}`);
    return release.manifest ? startDeploy(release, svc, release.manifest) : fail(release, 'Manifest 丢失');
  };

  const pollDeploy = async (release: Release, svc: Svc): Promise<StepResult> => {
    const status = await deps.deployer.status(svc.namespace, svc.name, release.targetSlot);
    const startedAt = release.pipeline.deployStartedAt ? new Date(release.pipeline.deployStartedAt).getTime() : clock.now().getTime();
    if (status.state === 'failed' || status.state === 'degraded') return fail(release, `待命槽部署失败：${status.message ?? status.state}`);
    if (status.state === 'deploying') {
      if (clock.now().getTime() - startedAt > deps.settings.deployTimeoutSeconds * 1000) return fail(release, '待命槽部署超时');
      await bump(release);
      return WAIT;
    }
    const now = clock.now();
    const exposes = release.manifest && release.manifest.kind !== 'EventProducer' ? release.manifest.spec.apis.exposes : undefined;
    const openapi = exposes ? await deps.repo.readFile(release.serviceId, release.tag, exposes.openapi.replace(/^\.\//, '')) : undefined;
    await uow.run(async (scope) => {
      const slots = await scope.slots.get(release.serviceId);
      if (slots) await scope.slots.save(withSlot(slots, { ...slots[release.targetSlot], state: 'ready', replicas: status.replicas, readyReplicas: status.readyReplicas, updatedAt: now }, now));
      await scope.events.publish(DomainTopic.releaseRegistered, {
        occurredAt: now.toISOString(), projectId: release.projectId, serviceId: release.serviceId, releaseId: release.id, tag: release.tag, commitSha: release.commitSha,
        manifest: release.manifest as Manifest, ...(openapi ? { openapiDocument: Bun.YAML.parse(openapi) } : {}),
      });
    });
    await save(release, 'ready');
    return DONE;
  };

  return async (releaseId: ReleaseId): Promise<StepResult> => {
    const release = await uow.read.releases.getById(releaseId);
    if (!release || !isInProgress(release)) return DONE;
    const svc = await deps.services.resolveServiceById(release.serviceId);
    if (!svc) return fail(release, '服务不存在');
    try {
      switch (release.status) {
        case 'pending': return await startBuild(release, svc);
        case 'building': return await pollBuild(release, svc);
        case 'migrating': return await pollMigration(release, svc);
        case 'deploying': return await pollDeploy(release, svc);
        default: return DONE;
      }
    } catch (error) {
      return fail(release, isPlatformError(error) ? error.message : String(error));
    }
  };
}
