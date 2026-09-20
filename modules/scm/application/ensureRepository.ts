import type { ProjectId, RepositoryBindingDto, ServiceId } from '@crewstation/contracts';
import { conflict } from '@crewstation/kernel';
import type { EnsureRepositoryInput } from '../api/moduleApi';
import { PLATFORM_PUSH_USERNAME, withCredential } from '../domain/remoteUrl';
import type { RepositoryBinding } from '../domain/repositoryBinding';
import { newBinding, repositoryHttpUrl, repositoryPath, transition } from '../domain/repositoryBinding';
import { RELEASE_TAG_PROTECTION_PATTERN } from '../domain/tagNaming';
import type { RemoteProject } from '../ports/gitLabGateway';
import type { ScmUseCaseDeps } from './dependencies';
import { bindingToDto } from './toDto';

const MAX_MESSAGE_LENGTH = 1000;

/**
 * 幂等建仓（R32／AT-25）：
 * 1. 已有 creating／ready 绑定 → 原样返回；failed 绑定 → 重试。
 * 2. 远端路径已存在但不是本服务上次建的 → conflict，绝不接管。
 * 3. 建远端项目 → 落 creating → 模板落盘 → 首个提交推默认分支 → 保护 `v*` → ready；任一步失败落 failed 并抛出。
 */
export function ensureRepositoryUseCase(deps: ScmUseCaseDeps) {
  const { uow, gitlab, settings, clock } = deps;
  return async (serviceId: ServiceId, projectId: ProjectId, input: EnsureRepositoryInput): Promise<RepositoryBindingDto> => {
    const existing = await uow.read.bindings.getByServiceId(serviceId);
    if (existing && existing.state !== 'failed') return bindingToDto(existing);
    const path = repositoryPath(settings.groupPath, input.slug);
    const owner = await uow.read.bindings.getByPath(path);
    if (owner && owner.serviceId !== serviceId) throw conflict(`仓库 ${path} 已绑定到服务 ${owner.serviceId}`, { pathWithNamespace: path });
    const remote = await claimRemote(deps, path, existing, serviceId);
    const project = remote ?? await gitlab.createProject({ groupPath: settings.groupPath, slug: input.slug, defaultBranch: settings.defaultBranch });
    const httpUrl = repositoryHttpUrl(settings.baseUrl, path);
    const now = clock.now();
    let binding: RepositoryBinding = existing
      ? transition({ ...existing, remoteProjectId: project.id, pathWithNamespace: path, httpUrl }, 'creating', now)
      : newBinding({ serviceId, projectId, remoteProjectId: project.id, pathWithNamespace: path, httpUrl, defaultBranch: settings.defaultBranch, now });
    await uow.run((scope) => scope.bindings.upsert(binding));
    try {
      await populate(deps, binding, input, remote !== undefined);
      binding = transition(binding, 'ready', clock.now());
    } catch (error) {
      binding = transition(binding, 'failed', clock.now(), describeFailure(error));
      await uow.run((scope) => scope.bindings.upsert(binding));
      throw error;
    }
    await uow.run((scope) => scope.bindings.upsert(binding));
    return bindingToDto(binding);
  };
}

/** 远端已有同路径项目时，只有它正是本服务上次失败尝试建出的那个才可以继续使用。 */
async function claimRemote(deps: ScmUseCaseDeps, path: string, existing: RepositoryBinding | undefined, serviceId: ServiceId): Promise<RemoteProject | undefined> {
  const remote = await deps.gitlab.findProject(path);
  if (remote && existing?.remoteProjectId !== remote.id) {
    throw conflict(`GitLab 上已存在 ${path} 且未绑定到服务 ${serviceId}；平台不接管既有仓库`, { pathWithNamespace: path, remoteProjectId: remote.id });
  }
  return remote;
}

/** 默认分支已存在（重试场景）就不再推模板，只补标签保护。 */
async function populate(deps: ScmUseCaseDeps, binding: RepositoryBinding, input: EnsureRepositoryInput, remoteExisted: boolean): Promise<void> {
  const { gitlab, git, templates, scratch, settings } = deps;
  const { templateId, initialPlan } = input;
  const hasDefaultBranch = remoteExisted && (await gitlab.getBranch(binding.remoteProjectId, binding.defaultBranch)) !== undefined;
  if (!hasDefaultBranch) {
    const dir = await scratch.create('cs-scm-init');
    try {
      await templates.materialize(templateId, dir.path, initialPlan, { projectId: binding.projectId, serviceId: binding.serviceId });
      await git.initAndPush({
        workdir: dir.path,
        remoteUrlWithCredential: withCredential(binding.httpUrl, PLATFORM_PUSH_USERNAME, settings.platformToken),
        branch: binding.defaultBranch,
        message: `chore: initialize from template ${templateId}`,
      });
    } finally {
      await dir.remove();
    }
  }
  await gitlab.ensureTagProtection(binding.remoteProjectId, RELEASE_TAG_PROTECTION_PATTERN);
}

function describeFailure(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > MAX_MESSAGE_LENGTH ? `${text.slice(0, MAX_MESSAGE_LENGTH)}…` : text;
}
