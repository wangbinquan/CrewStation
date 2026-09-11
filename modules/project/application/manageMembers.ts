import type { Actor, MemberDto, ProjectId, SetMemberRequest, UserId } from '@crewstation/contracts';
import { forbidden, precondition, validation } from '@crewstation/kernel';
import { authorizationUseCases } from './authorization';
import type { ProjectUseCaseDeps } from './dependencies';
import { memberToDto } from './toDto';

/** 负责人管理成员与 preview 测试者；负责人本人的角色只能由管理员转移。 */
export function memberUseCases(deps: ProjectUseCaseDeps) {
  const { uow, users } = deps;
  const { authorize } = authorizationUseCases(deps);
  return {
    listMembers: async (actor: Actor, projectId: ProjectId): Promise<MemberDto[]> => {
      await authorize(actor, projectId, 'view');
      const memberships = await uow.read.memberships.list(projectId);
      return Promise.all(memberships.map(async (m) => memberToDto(m, await users.getUser(m.userId))));
    },
    setMember: async (actor: Actor, projectId: ProjectId, input: SetMemberRequest): Promise<MemberDto> => {
      await authorize(actor, projectId, input.role === 'tester' ? 'manage-testers' : 'manage-members');
      if (input.role === 'owner' && !actor.isAdmin) throw forbidden('负责人只能由管理员转移');
      const user = await users.getUser(input.userId);
      if (!user) throw validation(`用户 ${input.userId} 不存在`);
      return uow.run(async (scope) => {
        const project = await scope.projects.getById(projectId);
        if (project && project.ownerUserId === input.userId && input.role !== 'owner') throw precondition('不能降级当前负责人，请先转移负责人');
        if (input.role === 'owner' && project) {
          await scope.memberships.upsert({ projectId, userId: project.ownerUserId, role: 'developer' });
          await scope.projects.update({ ...project, ownerUserId: input.userId, updatedAt: deps.clock.now() });
        }
        await scope.memberships.upsert({ projectId, userId: input.userId, role: input.role });
        return memberToDto({ projectId, userId: input.userId, role: input.role }, user);
      });
    },
    removeMember: async (actor: Actor, projectId: ProjectId, userId: UserId): Promise<void> => {
      await authorize(actor, projectId, 'manage-members');
      await uow.run(async (scope) => {
        const project = await scope.projects.getById(projectId);
        if (project?.ownerUserId === userId) throw precondition('不能移除负责人');
        await scope.memberships.remove(projectId, userId);
      });
    },
  };
}
