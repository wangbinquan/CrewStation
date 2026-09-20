import type { Manifest } from '@crewstation/contracts';
import { ManifestSchema, describeManifestFailure } from '@crewstation/contracts';
import { isPlatformError, validation } from '@crewstation/kernel';
import { assertMigrationAllowed } from '../domain/migrationPolicy';
import type { Release } from '../domain/release';
import type { ReleaseUseCaseDeps } from './dependencies';
import type { PipelineContext, ResolvedService, StepResult } from './pipelineContext';
import { WAIT } from './pipelineContext';
import { renderSlotEnv } from './pipelineEnv';

export interface BuildSteps {
  startBuild(release: Release, svc: ResolvedService): Promise<StepResult>;
  pollBuild(release: Release, svc: ResolvedService): Promise<StepResult>;
}

/** 构建阶段：提交构建 Job，成功后读取标签处的 Manifest，决定进入迁移还是直接部署。 */
export function buildSteps(deps: ReleaseUseCaseDeps, ctx: PipelineContext, startDeploy: (release: Release, svc: ResolvedService, manifest: Manifest) => Promise<StepResult>): BuildSteps {
  const loadManifest = async (release: Release): Promise<Manifest> => {
    const text = await deps.repo.readFile(release.serviceId, release.tag, 'crewstation.yaml');
    if (!text) throw new Error('仓库中没有 crewstation.yaml');
    const parsed = ManifestSchema.safeParse(Bun.YAML.parse(text));
    // 与开发会话同一套说法：说清错在哪，也说清改成什么。
    if (!parsed.success) throw validation(`crewstation.yaml 无效：${describeManifestFailure(parsed.error)}`);
    return parsed.data;
  };

  const afterBuild = async (release: Release, svc: ResolvedService): Promise<StepResult> => {
    let manifest: Manifest;
    try {
      manifest = await loadManifest(release);
      assertMigrationAllowed(manifest.spec.release.migration, deps.settings.maintenanceWindow);
    } catch (error) {
      return ctx.fail(release, isPlatformError(error) ? error.message : `Manifest 无效：${String(error)}`);
    }
    const command = manifest.spec.release.migrationCommand;
    if (!command) return startDeploy(release, svc, manifest);
    let env: Awaited<ReturnType<typeof renderSlotEnv>>;
    try {
      env = await renderSlotEnv(deps, { projectId: release.projectId, serviceId: release.serviceId, projectSlug: svc.slug, serviceName: svc.name, physical: release.targetSlot, manifest });
    } catch (error) {
      return ctx.fail(release, isPlatformError(error) ? error.message : String(error));
    }
    const { migrationRef } = await deps.migrator.start({ legacyResourceId: release.legacyResourceId, releaseId: release.id, namespace: svc.namespace, image: release.image ?? '', command, env: env.values });
    await ctx.save(release, 'migrating', { manifest, configVersion: env.configVersion, pipeline: { ...release.pipeline, migrationRef } });
    return WAIT;
  };

  return {
    startBuild: async (release, svc) => {
      const image = `${deps.settings.registryBase}/${svc.slug}:${release.tag}`;
      const { httpUrl, credentialSecretName } = await deps.repo.repositoryUrl(release.serviceId);
      const { buildRef } = await deps.builder.start({ legacyResourceId: release.legacyResourceId, releaseId: release.id, namespace: svc.namespace, repoHttpUrl: httpUrl, credentialSecretName, ref: release.tag, image });
      await ctx.save(release, 'building', { image, pipeline: { ...release.pipeline, buildRef } });
      return WAIT;
    },
    pollBuild: async (release, svc) => {
      const status = await deps.builder.status(release.pipeline.buildRef ?? '', svc.namespace);
      if (status.state === 'running') { await ctx.bump(release); return WAIT; }
      if (status.state === 'failed') return ctx.fail(release, `构建失败：${status.message}`);
      return afterBuild(release, svc);
    },
  };
}
