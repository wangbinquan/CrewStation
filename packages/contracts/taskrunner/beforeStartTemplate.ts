/**
 * 启动前 Hook 的模板变量语法（RFC-004 §5.1）。平台保存时校验、容器内执行时展开，两侧共用这一份解析，
 * 否则“保存能过、启动才报未定义变量”。只展开已声明的有限变量，不执行任何表达式。
 */
export const TEMPLATE_CONTEXT_NAMES = ['agent.home', 'agent.runDir', 'agent.id', 'workspace'] as const;
export type TemplateContextName = (typeof TEMPLATE_CONTEXT_NAMES)[number];

export type TemplateReference =
  | { kind: 'context'; name: TemplateContextName }
  | { kind: 'vars' | 'secrets' | 'env'; name: string };

export interface TemplateToken { raw: string; index: number; reference: TemplateReference | undefined }

const REFERENCE_RE = /\{\{\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\}\}/g;
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

/** 把 `{{ns.NAME}}` 一类占位解析为引用；未知命名空间或非法名字的 reference 为 undefined。 */
export function parseTemplateReference(path: string): TemplateReference | undefined {
  if ((TEMPLATE_CONTEXT_NAMES as readonly string[]).includes(path)) return { kind: 'context', name: path as TemplateContextName };
  const dot = path.indexOf('.');
  if (dot < 0) return undefined;
  const namespace = path.slice(0, dot), name = path.slice(dot + 1);
  if ((namespace !== 'vars' && namespace !== 'secrets' && namespace !== 'env') || !ENV_NAME_RE.test(name)) return undefined;
  return { kind: namespace, name };
}

export function scanTemplate(template: string): TemplateToken[] {
  const tokens: TemplateToken[] = [];
  for (const match of template.matchAll(REFERENCE_RE)) tokens.push({ raw: match[0], index: match.index ?? 0, reference: parseTemplateReference(match[1]!) });
  return tokens;
}

/** 按 token 顺序替换；每个引用由调用方给值，给不出即抛。JSON 场景由调用方先把值转义再传入 resolve。 */
export function renderTemplate(template: string, resolve: (reference: TemplateReference, raw: string) => string): string {
  return template.replace(REFERENCE_RE, (raw, path: string) => {
    const reference = parseTemplateReference(path);
    if (!reference) throw new TemplateReferenceError(raw, `无法识别的模板变量 ${raw}`);
    return resolve(reference, raw);
  });
}

export class TemplateReferenceError extends Error {
  constructor(readonly raw: string, message: string) {
    super(message);
    this.name = 'TemplateReferenceError';
  }
}
