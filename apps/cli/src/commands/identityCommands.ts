import { yesNo } from '../output/formatValue';
import type { CommandContext } from '../runtime/commandContext';

/** GET /v1/me：网关注入的当前用户。配错令牌时它是最快的自检。 */
export async function whoami(ctx: CommandContext): Promise<void> {
  const me = await ctx.client().me.get();
  if (ctx.json) return ctx.emit.json(me);
  ctx.emit.fields([
    ['ID', me.id], ['姓名', me.name], ['邮箱', me.email],
    ['平台管理员', yesNo(me.isAdmin)], ['登录方式', me.authMethod === 'oidc' ? '公司身份（OIDC）' : '用户名密码'],
    ['项目成员关系', me.memberships.length === 0 ? '-' : me.memberships.map((item) => `${item.projectId}:${item.role}`).join(' ')],
  ]);
  // 关闭常规登录要求「当前会话来自 OIDC」，所以这条提示直接对应下一步能不能做（RFC-005 §6.1）。
  if (me.authMethod === 'password') ctx.emit.warn('当前是本地用户名密码会话：关闭常规登录需要先用公司身份登录');
}
