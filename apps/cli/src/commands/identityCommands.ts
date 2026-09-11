import { yesNo } from '../output/formatValue';
import type { CommandContext } from '../runtime/commandContext';

/** GET /v1/me：网关注入的当前用户。配错令牌时它是最快的自检。 */
export async function whoami(ctx: CommandContext): Promise<void> {
  const me = await ctx.client().me.get();
  if (ctx.json) return ctx.emit.json(me);
  ctx.emit.fields([
    ['ID', me.id], ['姓名', me.name], ['邮箱', me.email],
    ['平台管理员', yesNo(me.isAdmin)], ['演示身份', yesNo(me.demoIdentity)],
    ['项目成员关系', me.memberships.length === 0 ? '-' : me.memberships.map((item) => `${item.projectId}:${item.role}`).join(' ')],
  ]);
  if (me.demoIdentity) ctx.emit.warn('当前是演示身份适配器登录，不要当作公司身份使用');
}
