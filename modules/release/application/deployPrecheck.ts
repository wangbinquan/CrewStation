import type { Manifest, ProjectId, ServicePlanDto } from '@crewstation/contracts';
import { ManifestSchema, describeManifestFailure } from '@crewstation/contracts';
import { isPlatformError } from '@crewstation/kernel';
import type { PrecheckReason } from '../domain/precheck';
import { precheckReason } from '../domain/precheck';
import type { Release } from '../domain/release';
import type { PhysicalSlot } from '../domain/slots';
import type { SlotDeploySpec } from '../ports/delivery';
import type { ReleaseUseCaseDeps } from './dependencies';
import type { ResolvedService } from './pipelineContext';
import type { RenderedEnv } from './pipelineEnv';
import { renderSlotEnv } from './pipelineEnv';

const PROFILE_HINT = '在 crewstation.yaml 里改用现有档位后发布新版本，或请管理员恢复档位';

/**
 * Manifest 的 tasks.agentProfiles 引用的档位问题（RFC-006 §4.4）：不存在（档位被删）、是通用终端协议、写了 default 而平台没有默认档位。
 * 只看存在性与协议，不看测试状态。没有问题返回 undefined。
 */
async function computeReason(deps: ReleaseUseCaseDeps, manifest: Manifest, projectId: ProjectId): Promise<PrecheckReason | undefined> {
  const wanted = manifest.kind === 'DigitalWorker' ? [...new Set((manifest.spec.tasks?.agentProfiles ?? []).map((p) => p.compute))] : [];
  const found = await Promise.all(wanted.map(async (name) => {
    try { return { name, profile: await deps.plans.lookupComputeProfile(name, projectId), error: undefined }; }
    catch (error) { if (!isPlatformError(error)) throw error; return { name, profile: undefined, error: error.message }; }
  }));
  const denied = found.find((entry) => entry.error);
  if (denied?.error) return precheckReason('profile-denied', denied.error, '请管理员把档位开放给本项目，或在 crewstation.yaml 里换一个可用的档位后发布新版本');
  if (found.some((f) => f.name.kind === 'default' && !f.profile)) return precheckReason('profile-default-unset', '算力档位 default 指向平台默认档位，但平台尚未设置默认档位', '请管理员在平台管理里设置默认档位');
  const missing = found.filter((f) => !f.profile).map((f) => f.name.kind === 'profile' ? f.name.profileId : 'default');
  if (missing.length > 0) return precheckReason('profile-missing', `算力档位 ${missing.join('、')} 不存在；现有档位：${(await deps.plans.listComputeProfiles()).join('、') || '（空）'}`, PROFILE_HINT);
  const terminal = found.filter((f) => f.profile?.terminalOnly).map((f) => f.name.kind === 'profile' ? f.name.profileId : 'default');
  if (terminal.length > 0) return precheckReason('profile-terminal-only', `算力档位 ${terminal.join('、')} 是通用终端协议，只能用于「＋ CLI」，不能用于业务子任务`, '在 crewstation.yaml 里给业务子任务换一个 Agent 协议的档位后发布新版本');
  return undefined;
}

export interface SlotDeployPlan { readonly plan: ServicePlanDto; readonly replicas: number; readonly env: RenderedEnv }

/**
 * 部署到某个槽之前的全部检查与环境渲染（统一预检的领域部分，RFC-025 设计 §5）：Manifest 按当前写法、套餐与副本（含运维覆盖）、
 * 算力档位、生产配置。有问题返回标准原因，不写任何东西；发布流水线据此把发布记为失败，重新部署据此直接拒绝（RFC-021 §4）。
 */
export async function prepareSlotDeploy(deps: ReleaseUseCaseDeps, release: Release, svc: ResolvedService, manifest: Manifest, physical: PhysicalSlot): Promise<SlotDeployPlan | { readonly reason: PrecheckReason }> {
  // 发布记录里的 Manifest 是当时校验过的；平台之后收紧了写法的旧版本（如 RFC-001 之前的 driver／model）按当前写法说清原因，
  // 不带进后面的检查（2026-09-23 实机：demo 重新部署 v0.1.2 在读 compute 时 500）。
  const current = ManifestSchema.safeParse(manifest);
  if (!current.success) {
    return { reason: precheckReason('manifest-outdated', `${release.tag} 的 Manifest 不符合当前平台的写法，不能部署：${describeManifestFailure(current.error)}`, '发布记录里的 Manifest 随标签固定，请改好仓库里的 crewstation.yaml 后发布新版本') };
  }
  const plan = await deps.plans.getServicePlan(manifest.spec.service.servicePlanId, release.projectId);
  if (!plan) return { reason: precheckReason('plan-unavailable', `服务套餐 ${manifest.spec.service.servicePlanId} 不存在或已不对本项目开放`, '请管理员恢复套餐或把它开放给本项目，或在 crewstation.yaml 里换一个可用的套餐后发布新版本') };
  if (manifest.spec.service.replicas > plan.maxReplicas) return { reason: precheckReason('replicas-over-plan', `副本数 ${manifest.spec.service.replicas} 超过套餐上限 ${plan.maxReplicas}`, '把 crewstation.yaml 里的 replicas 调到上限以内后发布新版本，或换更大的套餐') };
  const replicas = await deps.uow.read.maintenance.override(release.serviceId, physical) ?? manifest.spec.service.replicas;
  if (replicas > plan.maxReplicas) return { reason: precheckReason('replicas-override-over-plan', `运维副本覆盖 ${replicas} 超过套餐上限 ${plan.maxReplicas}`, '请管理员调整或恢复发布配置') };
  // 算力档位有问题就不进部署（RFC-001、RFC-006），与引用不存在的服务套餐同等对待。
  const profile = await computeReason(deps, manifest, release.projectId);
  if (profile) return { reason: profile };
  try {
    return { plan, replicas, env: await renderSlotEnv(deps, { projectId: release.projectId, serviceId: release.serviceId, projectSlug: svc.slug, serviceName: svc.name, physical, manifest }) };
  } catch (error) {
    if (isPlatformError(error)) return { reason: precheckReason('config-incomplete', error.message, '在项目设置里补齐生产组配置后重试') };
    throw error;
  }
}

/**
 * 平台预检的集群一步（RFC-025 设计 §5）：把要部署的 Deployment 与 Service 以服务端 dry-run 提交一次——资源规格、准入策略、命名空间配额
 * 这类只有 API Server 才判得了的问题在受理之前就说清，不在部署途中抛错。槽的渲染还在 release，这一步随它；渲染移交资源中心后改经它的端口。
 */
export async function dryRunReason(deps: Pick<ReleaseUseCaseDeps, 'deployer'>, spec: SlotDeploySpec): Promise<PrecheckReason | undefined> {
  try {
    await deps.deployer.dryRun(spec);
    return undefined;
  } catch (error) {
    return precheckReason('cluster-rejected', `集群拒绝了这次部署：${error instanceof Error ? error.message : String(error)}`, '检查套餐的资源规格与项目命名空间的配额，或联系管理员');
  }
}
