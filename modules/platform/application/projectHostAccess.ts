import type { UserId } from '@crewstation/contracts';
import type { ProjectHostDirectory } from '../ports/projectHostAccess';

/** 待命版与开发预览只给项目成员；正式版按应用可见范围授权。惰性读取避免装配顺序耦合。 */
export function projectHostAccess<Verdict>(project: () => ProjectHostDirectory<Verdict>) {
  return {
    previewAccess: { canView: async (userId: UserId, slug: string) => {
      const resolved = await project().resolveServiceIdentity(`${slug}/${slug}`);
      const role = resolved ? await project().roleOf({ userId, isAdmin: await project().isAdmin(userId) }, resolved.projectId) : undefined;
      return role !== undefined && role !== 'user';
    } },
    appAccess: { check: (user: { readonly id: UserId; readonly isAdmin: boolean }, slug: string) => project().appAccessBySlug(user, slug) },
  };
}
