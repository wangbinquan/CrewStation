import type { PlatformMcpEndpoints } from '@crewstation/agent-drivers';
import type { TemplateContextName, TemplateReference } from '@crewstation/contracts';
import { TemplateReferenceError, renderTemplate } from '@crewstation/contracts';
import { BeforeStartFailure } from './failure';

/** 一次执行的展开上下文：固定上下文变量、普通变量、凭据、之前脚本输出的环境变量。 */
export interface HookContext {
  readonly agentId: string;
  readonly home: string;
  readonly runDir: string;
  readonly workspace: string;
  readonly vars: Record<string, string>;
  readonly secrets: Record<string, string>;
  /** 平台两个 MCP 的地址与本次启动的会话令牌（RFC-006 C16）；没有对应连接的项为空。 */
  readonly mcp: PlatformMcpEndpoints;
  /** 由之前的脚本步骤经 CS_HOOK_ENV_OUT 输出，按顺序累积。 */
  env: Record<string, string>;
}

function contextValue(ctx: HookContext, name: TemplateContextName, raw: string): string {
  switch (name) {
    case 'agent.home': return ctx.home;
    case 'agent.runDir': return ctx.runDir;
    case 'agent.id': return ctx.agentId;
    case 'workspace': return ctx.workspace;
    case 'mcp.capabilitiesUrl': return present(ctx.mcp.capabilitiesUrl, raw);
    case 'mcp.operationsUrl': return present(ctx.mcp.operationsUrl, raw);
    case 'mcp.token': return present(ctx.mcp.token, raw);
  }
}

/** 业务子任务没有开发会话令牌（open question I2）：引用了拿不到的 MCP 项即按未定义变量失败，不展开成空串。 */
function present(value: string | undefined, raw: string): string {
  if (value === undefined) throw new BeforeStartFailure('template_variable_undefined', `模板变量 ${raw} 未定义：本次启动没有对应的平台 MCP 连接`);
  return value;
}

function lookup(ctx: HookContext, reference: TemplateReference, raw: string): string {
  if (reference.kind === 'context') return contextValue(ctx, reference.name, raw);
  const source = reference.kind === 'vars' ? ctx.vars : reference.kind === 'secrets' ? ctx.secrets : ctx.env;
  const value = source[reference.name];
  if (value === undefined) throw new BeforeStartFailure('template_variable_undefined', `模板变量 ${raw} 未定义${reference.kind === 'env' ? '：之前的脚本没有输出它' : ''}`);
  return value;
}

/** 文本模板按字面值展开；JSON／JSONC 模板把值按 JSON 字符串转义后展开，不会破坏引号结构。 */
export function expandTemplate(template: string, ctx: HookContext, options: { json?: boolean; stepId?: string } = {}): string {
  try {
    return renderTemplate(template, (reference, raw) => {
      const value = lookup(ctx, reference, raw);
      return options.json ? JSON.stringify(value).slice(1, -1) : value;
    });
  } catch (error) {
    if (error instanceof BeforeStartFailure) throw new BeforeStartFailure(error.code, error.message, options.stepId);
    if (error instanceof TemplateReferenceError) throw new BeforeStartFailure('template_variable_undefined', error.message, options.stepId);
    throw error;
  }
}

/** 可读日志里要遮盖的值：全部凭据，加上平台 MCP 的会话令牌（它可以经模板写进文件，也进脚本环境）。 */
export function sensitiveValues(ctx: Pick<HookContext, 'secrets' | 'mcp'>): string[] {
  return [...Object.values(ctx.secrets), ...(ctx.mcp.token === undefined ? [] : [ctx.mcp.token])];
}

/** 把已知敏感值从可读日志里替换掉；只替换非空值，短到会误伤普通文本的值（<4 字）也照替。 */
export function redactSecrets(text: string, values: readonly string[]): string {
  let out = text;
  for (const value of values) if (value.length > 0) out = out.split(value).join('***');
  return out;
}
