import { isAbsolute, normalize, resolve } from 'node:path';
import type { HookContext } from './templateContext';
import { expandTemplate } from './templateContext';
import { BeforeStartFailure } from './failure';

/**
 * 展开路径模板并规范化：支持容器内绝对路径、`~/`（相对 agent.home）与上下文变量开头的路径。
 * 展开后仍必须是绝对路径且不含 `..`；不做 realpath，落点由写入时的 open/rename 决定。
 */
export function resolveHookPath(template: string, ctx: HookContext, stepId: string): string {
  let expanded = expandTemplate(template, ctx, { stepId });
  if (expanded.startsWith('~/')) expanded = `${ctx.home}/${expanded.slice(2)}`;
  if (expanded.includes('\0') || !isAbsolute(expanded)) throw new BeforeStartFailure('path_denied', `路径 ${expanded} 不是容器内绝对路径`, stepId);
  const normalized = normalize(resolve(expanded));
  if (/(^|\/)\.\.(\/|$)/.test(expanded)) throw new BeforeStartFailure('path_denied', `路径 ${expanded} 不能包含 ..`, stepId);
  return normalized;
}

/** 私有目录（agent.home／agent.runDir 之下）随进程清理；其余为同容器共享的固定路径。 */
export function isPrivatePath(path: string, ctx: Pick<HookContext, 'home' | 'runDir'>): boolean {
  return [ctx.home, ctx.runDir].some((root) => path === root || path.startsWith(`${root}/`));
}
