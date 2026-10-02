import type { CreateReleaseTagRequest, ReleaseTagDto, ServiceId } from '@crewstation/contracts';
import { conflict, notFound, validation } from '@crewstation/kernel';
import { latestReleaseTag, nextTag } from '../domain/tagNaming';
import type { ScmUseCaseDeps } from '../ports/useCaseDependencies';
import { withScmServiceWrite } from './projectAdmission';
import { loadReadyBinding } from './queryRepository';

/** 发布打标只走平台令牌：`v*` 受保护，业务用户在 GitLab 上没有创建权（Design §6）。 */
export function createReleaseTagUseCase(deps: ScmUseCaseDeps) {
  const { uow, gitlab } = deps;
  return (serviceId: ServiceId, input: CreateReleaseTagRequest): Promise<ReleaseTagDto> => withScmServiceWrite(deps, serviceId, 'release-tag', async () => {
    const selector = input.tag ?? input.bump;
    if (selector === undefined) throw validation('bump 与 tag 必须指定一个');
    const binding = await loadReadyBinding(uow, serviceId);
    const tags = await gitlab.listTags(binding.remoteProjectId);
    const name = nextTag(latestReleaseTag(tags.map((t) => t.name)), selector);
    if (tags.some((t) => t.name === name)) throw conflict(`标签 ${name} 已存在`, { tag: name });
    const branch = await gitlab.getBranch(binding.remoteProjectId, input.branch);
    if (!branch) throw notFound('分支', input.branch);
    if (input.expectedCommitSha && input.expectedCommitSha !== branch.headSha) throw conflict('远端分支已变化，请重新确认发布来源', { branch: input.branch, expected: input.expectedCommitSha, actual: branch.headSha });
    const created = await gitlab.createTag(binding.remoteProjectId, { name, ref: branch.headSha, message: `CrewStation release ${name}` });
    return { tag: created.name, commitSha: created.commitSha };
  });
}
