import type { Actor, BranchDto, RepositoryBindingDto, ServiceId, TagDto } from '@crewstation/contracts';
import type { ListBranchesOptions } from '../api/moduleApi';
import type { RepositoryBinding } from '../domain/repositoryBinding';
import type { ScmUseCaseDeps } from './dependencies';
import { loadBinding, loadReadyBinding } from './loadBinding';
import { bindingToDto, tagToDto } from './toDto';

/**
 * 网页地址列加入之前建的绑定没有 webUrl：第一次被读到时向 GitLab 查一次并存下，之后不再查（2026-09-23 作者裁定）。
 * 只补已就绪的绑定，且远端项目 ID 要与绑定一致；GitLab 查不到或不可达时原样返回（浏览器退回克隆地址），下次读取再试。
 */
async function withWebUrl({ uow, gitlab }: ScmUseCaseDeps, binding: RepositoryBinding): Promise<RepositoryBinding> {
  if (binding.webUrl !== undefined || binding.state !== 'ready') return binding;
  const remote = await gitlab.findProject(binding.pathWithNamespace).catch(() => undefined);
  if (remote?.id !== binding.remoteProjectId) return binding;
  const filled: RepositoryBinding = { ...binding, webUrl: remote.webUrl };
  await uow.run((scope) => scope.bindings.upsert(filled));
  return filled;
}

export function queryRepositoryUseCases(deps: ScmUseCaseDeps) {
  const { uow, gitlab, authorizer } = deps;
  const viewable = async (actor: Actor, serviceId: ServiceId, ready: boolean): Promise<RepositoryBinding> => {
    const binding = ready ? await loadReadyBinding(uow, serviceId) : await loadBinding(uow, serviceId);
    await authorizer.authorize(actor, binding.projectId, 'view');
    return binding;
  };
  const behind = async (remoteProjectId: string, headSha: string, slotSha: string | undefined): Promise<number | null> =>
    slotSha === undefined ? null : (await gitlab.countCommitsBehind(remoteProjectId, { from: headSha, to: slotSha })) ?? null;
  return {
    getBinding: async (actor: Actor, serviceId: ServiceId): Promise<RepositoryBindingDto> => bindingToDto(await withWebUrl(deps, await viewable(actor, serviceId, false))),
    /** 内部读取（无 actor）：release 取标签处的 Manifest 与 OpenAPI，dev-session 取分支处的预览配置。 */
    readFile: async (serviceId: ServiceId, ref: string, path: string): Promise<string | undefined> => gitlab.readFile((await loadReadyBinding(uow, serviceId)).remoteProjectId, path, ref),
    /** 逐分支计算落后数：调用量与分支数成正比，故串行而不并发压 GitLab。 */
    listBranches: async (actor: Actor, serviceId: ServiceId, options: ListBranchesOptions = {}): Promise<BranchDto[]> => {
      const binding = await viewable(actor, serviceId, true);
      const items: BranchDto[] = [];
      for (const branch of await gitlab.listBranches(binding.remoteProjectId)) {
        items.push({
          name: branch.name,
          headSha: branch.headSha,
          isDefault: branch.isDefault,
          behindPreview: await behind(binding.remoteProjectId, branch.headSha, options.previewSha),
          behindProd: await behind(binding.remoteProjectId, branch.headSha, options.prodSha),
        });
      }
      return items;
    },
    listTags: async (actor: Actor, serviceId: ServiceId): Promise<TagDto[]> => {
      const binding = await viewable(actor, serviceId, true);
      return (await gitlab.listTags(binding.remoteProjectId)).map(tagToDto);
    },
  };
}
