import type { CreateReleaseTagRequest, ReleaseTagDto, ServiceId } from '@crewstation/contracts';
import { conflict, notFound, validation } from '@crewstation/kernel';
import { latestReleaseTag, nextTag } from '../domain/tagNaming';
import type { ScmUseCaseDeps } from './dependencies';
import { loadReadyBinding } from './loadBinding';

/** 发布打标只走平台令牌：`v*` 受保护，业务用户在 GitLab 上没有创建权（Design §6）。 */
export function createReleaseTagUseCase({ uow, gitlab }: ScmUseCaseDeps) {
  return async (serviceId: ServiceId, input: CreateReleaseTagRequest): Promise<ReleaseTagDto> => {
    const selector = input.tag ?? input.bump;
    if (selector === undefined) throw validation('bump 与 tag 必须指定一个');
    const binding = await loadReadyBinding(uow, serviceId);
    const tags = await gitlab.listTags(binding.remoteProjectId);
    const name = nextTag(latestReleaseTag(tags.map((t) => t.name)), selector);
    if (tags.some((t) => t.name === name)) throw conflict(`标签 ${name} 已存在`, { tag: name });
    const branch = await gitlab.getBranch(binding.remoteProjectId, input.branch);
    if (!branch) throw notFound('分支', input.branch);
    const created = await gitlab.createTag(binding.remoteProjectId, { name, ref: branch.headSha, message: `CrewStation release ${name}` });
    return { tag: created.name, commitSha: created.commitSha };
  };
}
