import { dash, shortSha } from '../output/formatValue';
import { resolveProject } from '../platform/projectLookup';
import type { CommandContext } from '../runtime/commandContext';
import { requiredArg } from '../runtime/commandContext';

/** GET /v1/projects：管理员看全部，成员看自己所在的项目。 */
export async function listProjects(ctx: CommandContext): Promise<void> {
  const page = await ctx.client().projects.list();
  if (ctx.json) return ctx.emit.json(page);
  ctx.emit.table(
    ['SLUG', '名称', '类型', '状态', '命名空间', 'ID'],
    page.items.map((project) => [project.slug, project.name, project.kind, project.state, project.namespace, project.id]),
  );
}

export async function showProject(ctx: CommandContext): Promise<void> {
  const project = await resolveProject(ctx.client(), requiredArg(ctx, 0, 'project'));
  if (ctx.json) return ctx.emit.json(project);
  ctx.emit.fields([
    ['ID', project.id], ['slug', project.slug], ['名称', project.name], ['类型', project.kind],
    ['状态', project.state], ['命名空间', project.namespace], ['负责人', project.ownerUserId],
    ['服务 ID', dash(project.serviceId)], ['创建时间', project.createdAt], ['说明', dash(project.message)],
  ]);
}

/** 分支与落后两槽的提交数（Design §6.2 的分支下拉就是这份数据）。 */
export async function listBranches(ctx: CommandContext): Promise<void> {
  const api = ctx.client();
  const project = await resolveProject(api, requiredArg(ctx, 0, 'project'));
  const page = await api.devSession.listBranches(project.id);
  if (ctx.json) return ctx.emit.json(page);
  ctx.emit.table(
    ['分支', 'HEAD', '默认', '落后 preview', '落后 prod'],
    page.items.map((branch) => [branch.name, shortSha(branch.headSha), branch.isDefault ? '是' : '', behind(branch.behindPreview), behind(branch.behindProd)]),
  );
}

/** null 表示服务端算不出（槽里还没有部署），与 0 不是一回事。 */
function behind(value: number | null): string {
  return value === null ? '未知' : String(value);
}
