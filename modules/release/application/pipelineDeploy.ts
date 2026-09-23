import type { Manifest, ProjectId, ServicePlanDto } from '@crewstation/contracts';
import { isPlatformError } from '@crewstation/kernel';
import { DomainTopic, ManifestSchema, describeManifestFailure } from '@crewstation/contracts';
import type { Release } from '../domain/release';
import { advance } from '../domain/release';
import { startRetention } from '../domain/slotLifecycle';
import type { PhysicalSlot } from '../domain/slots';
import { withSlot } from '../domain/slots';
import type { ReleaseUseCaseDeps } from './dependencies';
import type { PipelineContext, ResolvedService, StepResult } from './pipelineContext';
import { DONE, WAIT } from './pipelineContext';
import type { RenderedEnv } from './pipelineEnv';
import { renderSlotEnv } from './pipelineEnv';

export interface DeploySteps {
  startDeploy(release: Release, svc: ResolvedService, manifest: Manifest): Promise<StepResult>;
  pollMigration(release: Release, svc: ResolvedService): Promise<StepResult>;
  pollDeploy(release: Release, svc: ResolvedService): Promise<StepResult>;
}

/** 部署阶段：待命槽换上新发布并标记旧发布 superseded；就绪后登记 Manifest 与 OpenAPI。 */
/**
 * Manifest 的 tasks.agentProfiles 引用的档位问题（RFC-006 §4.4）：不存在、是通用终端协议、写了 default 而平台没有默认档位。
 * 只看存在性与协议，不看测试状态。返回给发布记录的原因文案；没有问题返回 undefined。
 */
async function computeProblem(deps: ReleaseUseCaseDeps, manifest: Manifest, projectId: ProjectId): Promise<string | undefined> {
  const wanted = manifest.kind === 'DigitalWorker' ? [...new Set((manifest.spec.tasks?.agentProfiles ?? []).map((p) => p.compute))] : [];
  const found = await Promise.all(wanted.map(async (name) => {
    try { return { name, profile: await deps.plans.lookupComputeProfile(name, projectId), error: undefined }; }
    catch (error) { if (!isPlatformError(error)) throw error; return { name, profile: undefined, error: error.message }; }
  }));
  const denied = found.find((entry) => entry.error);
  if (denied) return denied.error;
  if (found.some((f) => f.name.kind === 'default' && !f.profile)) return '算力档位 default 指向平台默认档位，但平台尚未设置默认档位；请管理员在平台管理里设置';
  const missing = found.filter((f) => !f.profile).map((f) => f.name.kind === 'profile' ? f.name.profileId : 'default');
  if (missing.length > 0) return `算力档位 ${missing.join('、')} 不存在；现有档位：${(await deps.plans.listComputeProfiles()).join('、') || '（空）'}`;
  const terminal = found.filter((f) => f.profile?.terminalOnly).map((f) => f.name.kind === 'profile' ? f.name.profileId : 'default');
  if (terminal.length > 0) return `算力档位 ${terminal.join('、')} 是通用终端协议，只能用于「＋ CLI」，不能用于业务子任务`;
  return undefined;
}

export interface SlotDeployPlan { readonly plan: ServicePlanDto; readonly replicas: number; readonly env: RenderedEnv }

/**
 * 部署到某个槽之前的全部检查与环境渲染：套餐、副本（含运维覆盖）、算力档位、生产配置。
 * 有问题返回原因，不写任何东西；发布流水线据此把发布记为失败，重新部署据此直接拒绝（RFC-021 §4）。
 */
export async function prepareSlotDeploy(deps: ReleaseUseCaseDeps, release: Release, svc: ResolvedService, manifest: Manifest, physical: PhysicalSlot): Promise<SlotDeployPlan | { problem: string }> {
  // 发布记录里的 Manifest 是当时校验过的；平台之后收紧了写法的旧版本（如 RFC-001 之前的 driver／model）按当前写法说清原因，
  // 不带进后面的检查（2026-09-23 实机：demo 重新部署 v0.1.2 在读 compute 时 500）。
  const current = ManifestSchema.safeParse(manifest);
  if (!current.success) return { problem: `${release.tag} 的 Manifest 不符合当前平台的写法，不能部署：${describeManifestFailure(current.error)}。发布记录里的 Manifest 随标签固定，请改好仓库里的 crewstation.yaml 后发布新版本` };
  const plan = await deps.plans.getServicePlan(manifest.spec.service.servicePlanId, release.projectId);
  if (!plan) return { problem: `服务套餐 ${manifest.spec.service.servicePlanId} 不存在` };
  if (manifest.spec.service.replicas > plan.maxReplicas) return { problem: `副本数 ${manifest.spec.service.replicas} 超过套餐上限 ${plan.maxReplicas}` };
  const replicas = await deps.uow.read.maintenance.override(release.serviceId, physical) ?? manifest.spec.service.replicas;
  if (replicas > plan.maxReplicas) return { problem: `运维副本覆盖 ${replicas} 超过套餐上限 ${plan.maxReplicas}，请管理员调整或恢复发布配置` };
  // 算力档位有问题就不进部署（RFC-001、RFC-006），与引用不存在的服务套餐同等对待。
  const problem = await computeProblem(deps, manifest, release.projectId);
  if (problem) return { problem };
  try {
    return { plan, replicas, env: await renderSlotEnv(deps, { projectId: release.projectId, serviceId: release.serviceId, projectSlug: svc.slug, serviceName: svc.name, physical, manifest }) };
  } catch (error) {
    if (isPlatformError(error)) return { problem: error.message };
    throw error;
  }
}

export function deploySteps(deps: ReleaseUseCaseDeps, ctx: PipelineContext): DeploySteps {
  const { uow, clock } = deps;

  const startDeploy: DeploySteps['startDeploy'] = async (release, svc, manifest) => {
    const prepared = await prepareSlotDeploy(deps, release, svc, manifest, release.targetSlot);
    if ('problem' in prepared) return ctx.fail(release, prepared.problem);
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
