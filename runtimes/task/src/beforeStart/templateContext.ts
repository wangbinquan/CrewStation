import type { TemplateReference } from '@crewstation/contracts';
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
  /** 由之前的脚本步骤经 CS_HOOK_ENV_OUT 输出，按顺序累积。 */
  env: Record<string, string>;
}

function lookup(ctx: HookContext, reference: TemplateReference, raw: string): string {
  if (reference.kind === 'context') {
    switch (reference.name) {
      case 'agent.home': return ctx.home;
      case 'agent.runDir': return ctx.runDir;
      case 'agent.id': return ctx.agentId;
      case 'workspace': return ctx.workspace;
    }
  }
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

/** 把已知凭据值从可读日志里替换掉；只替换非空值，短到会误伤普通文本的值（<4 字）也照替。 */
export function redactSecrets(text: string, secrets: Record<string, string>): string {
  let out = text;
  for (const value of Object.values(secrets)) if (value.length > 0) out = out.split(value).join('***');
  return out;
}
