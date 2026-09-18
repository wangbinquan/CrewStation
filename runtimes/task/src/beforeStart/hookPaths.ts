import { isAbsolute, normalize, resolve } from 'node:path';
import { TEMPLATE_PATH_CONTEXT_NAMES, scanTemplate } from '@crewstation/contracts';
import type { HookContext } from './templateContext';
import { expandTemplate } from './templateContext';
import { BeforeStartFailure } from './failure';

const PATH_CONTEXT_PREFIX = new RegExp(`^\\{\\{\\s*(?:${TEMPLATE_PATH_CONTEXT_NAMES.map((name) => name.replace('.', '\\.')).join('|')})\\s*\\}\\}`);

/**
 * 展开路径模板并规范化：支持容器内绝对路径、`~/`（相对 agent.home）与三个目录变量开头的路径。
 * 展开后仍必须是绝对路径且不含 `..`；不做 realpath，落点由写入时的 open/rename 决定。
 */
export function resolveHookPath(template: string, ctx: HookContext, stepId: string): string {
  assertPathTemplate(template, stepId);
  let expanded = expandTemplate(template, ctx, { stepId });
  if (expanded.startsWith('~/')) expanded = `${ctx.home}/${expanded.slice(2)}`;
  if (expanded.includes('\0') || !isAbsolute(expanded)) throw new BeforeStartFailure('path_denied', `路径 ${expanded} 不是容器内绝对路径`, stepId);
  const normalized = normalize(resolve(expanded));
  if (/(^|\/)\.\.(\/|$)/.test(expanded)) throw new BeforeStartFailure('path_denied', `路径 ${expanded} 不能包含 ..`, stepId);
  return normalized;
}

/**
 * 与保存校验（agent-runtime 的 assertPathTemplate）同一条规则，展开前再判一次：路径只能以 `/`、`~/`
 * 或 TEMPLATE_PATH_CONTEXT_NAMES 开头；平台 MCP 的地址与令牌只能进文件内容（RFC-006 C16），
 * 出现在路径里即拒绝——展开后的路径会写进租户可见的执行记录。
 */
function assertPathTemplate(template: string, stepId: string): void {
  if (!(template.startsWith('/') || template.startsWith('~/') || PATH_CONTEXT_PREFIX.test(template))) {
    throw new BeforeStartFailure('path_denied', `路径 ${template} 必须是绝对路径、以 ~/ 开头，或以 {{agent.home}}／{{agent.runDir}}／{{workspace}} 开头`, stepId);
  }
  if (scanTemplate(template).some((token) => token.reference?.kind === 'context' && token.reference.name.startsWith('mcp.'))) {
    throw new BeforeStartFailure('path_denied', `路径 ${template} 引用了平台 MCP 变量；它们只能用在文件内容里`, stepId);
  }
}

/** 私有目录（agent.home／agent.runDir 之下）随进程清理；其余为同容器共享的固定路径。 */
export function isPrivatePath(path: string, ctx: Pick<HookContext, 'home' | 'runDir'>): boolean {
  return [ctx.home, ctx.runDir].some((root) => path === root || path.startsWith(`${root}/`));
}
