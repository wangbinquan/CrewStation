import type { Actor, BranchDto, RepositoryBindingDto, ServiceId, TagDto } from '@crewstation/contracts';
import type { ListBranchesOptions } from '../api/moduleApi';
import type { RepositoryBinding } from '../domain/repositoryBinding';
import type { ScmUseCaseDeps } from './dependencies';
import { loadBinding, loadReadyBinding } from './loadBinding';
import { bindingToDto, tagToDto } from './toDto';

export function queryRepositoryUseCases({ uow, gitlab, authorizer }: ScmUseCaseDeps) {
  const viewable = async (actor: Actor, serviceId: ServiceId, ready: boolean): Promise<RepositoryBinding> => {
    const binding = ready ? await loadReadyBinding(uow, serviceId) : await loadBinding(uow, serviceId);
    await authorizer.authorize(actor, binding.projectId, 'view');
    return binding;
  };
  const behind = async (remoteProjectId: string, headSha: string, slotSha: string | undefined): Promise<number | null> =>
    slotSha === undefined ? null : (await gitlab.countCommitsBehind(remoteProjectId, { from: headSha, to: slotSha })) ?? null;
  return {
    getBinding: async (actor: Actor, serviceId: ServiceId): Promise<RepositoryBindingDto> => bindingToDto(await viewable(actor, serviceId, false)),
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
