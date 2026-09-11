import type { EgressPolicyDto, ProjectId } from '@crewstation/contracts';
import { mergePolicy } from '../domain/egressEntry';
import type { EgressUseCaseDeps } from './dependencies';

/** 某项目的有效放行清单（全局＋项目级，去重排序）；供 task-runtime／控制面配置出站代理，不经 actor。 */
export function policyUseCases({ uow }: EgressUseCaseDeps) {
  return {
    policyFor: async (projectId: ProjectId): Promise<EgressPolicyDto> => ({ allow: mergePolicy(await uow.read.entries.listEffective(projectId)) }),
  };
}
