import { z } from 'zod';

/** 资源正文：MCP 只传文本，结构化内容一律序列化后靠 mimeType 标注，避免两端各写一套解析。 */
export interface McpResourceBody {
  readonly mimeType: string;
  readonly text: string;
}

export interface McpResourceDefinition<Ctx> {
  readonly name: string;
  readonly uri: string;
  readonly title: string;
  readonly description: string;
  readonly mimeType: string;
  read(ctx: Ctx): Promise<McpResourceBody>;
}

/** 入参校验结果；与 SDK 解耦，单测直接断言它，不必起一个 MCP 客户端。 */
export type ToolInputCheck =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly message: string };

export interface McpToolDefinition<Ctx> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  /** 交给 SDK 生成 JSON Schema 的原始 shape；具体类型只在 defineTool 内部可见。 */
  readonly shape: z.ZodRawShape;
  checkInput(raw: unknown): ToolInputCheck;
  invoke(raw: unknown, ctx: Ctx): Promise<unknown>;
}

export interface McpServerDefinition<Ctx> {
  readonly name: string;
  readonly version: string;
  /** 连接后发给 Agent 的总说明：它决定 Agent 会不会用错服务器。 */
  readonly instructions: string;
  readonly resources: ReadonlyArray<McpResourceDefinition<Ctx>>;
  readonly tools: ReadonlyArray<McpToolDefinition<Ctx>>;
}

export function defineResource<Ctx>(spec: McpResourceDefinition<Ctx>): McpResourceDefinition<Ctx> {
  return spec;
}

/** 结构化资源的统一形状：UTF-8 JSON，两空格缩进，便于 Agent 直接读。 */
export function jsonResource<Ctx>(spec: {
  readonly name: string;
  readonly uri: string;
  readonly title: string;
  readonly description: string;
  read(ctx: Ctx): Promise<unknown>;
}): McpResourceDefinition<Ctx> {
  return {
    name: spec.name,
    uri: spec.uri,
    title: spec.title,
    description: spec.description,
    mimeType: 'application/json',
    read: async (ctx) => ({ mimeType: 'application/json', text: `${JSON.stringify(await spec.read(ctx), null, 2)}\n` }),
  };
}

export interface ToolSpec<Ctx, Shape extends z.ZodRawShape> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly input: Shape;
  run(args: z.infer<z.ZodObject<Shape>>, ctx: Ctx): Promise<unknown>;
}

/** 先固定上下文类型再让 shape 自行推断；TypeScript 不支持只显式给一半类型参数。 */
export function toolFactory<Ctx>(): <Shape extends z.ZodRawShape>(spec: ToolSpec<Ctx, Shape>) => McpToolDefinition<Ctx> {
  return (spec) => defineTool(spec);
}

/** 定义处保留精确入参类型，定义之外一律擦除；校验只在这里做一次，SDK 与单测共用同一条规则。 */
export function defineTool<Ctx, Shape extends z.ZodRawShape>(spec: ToolSpec<Ctx, Shape>): McpToolDefinition<Ctx> {
  const schema = z.object(spec.input);
  const check = (raw: unknown): ToolInputCheck => {
    const parsed = schema.safeParse(raw ?? {});
    return parsed.success ? { ok: true, value: parsed.data } : { ok: false, message: z.prettifyError(parsed.error) };
  };
  return {
    name: spec.name,
    title: spec.title,
    description: spec.description,
    shape: spec.input,
    checkInput: check,
    invoke: async (raw, ctx) => {
      const parsed = schema.safeParse(raw ?? {});
      if (!parsed.success) throw new Error(`入参不合法：${z.prettifyError(parsed.error)}`);
      return spec.run(parsed.data, ctx);
    },
  };
}
