import { z } from 'zod';
import { BusinessEnvironmentNameSchema, BusinessRelativePathSchema } from './executionValues';
import { BusinessPluginFileSchema, BUSINESS_NATIVE_MATERIAL_LIMITS, materialTreeIssue } from './materialFiles';

const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);
export const BusinessNativeNameSchema = z.string().min(1).max(80).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/).refine((value) => !forbiddenKeys.has(value) && !/^crewstation(?:$|[._-])/i.test(value) && !/^cs-platform(?:$|[._-])/i.test(value), '名称属于平台保留空间');
const key = z.string().min(1).max(256).refine((value) => !forbiddenKeys.has(value), '禁止原型键');
const text = z.string().max(32768).refine((value) => !value.includes('\0'), '不能包含 NUL');
const permissionAction = z.enum(['allow', 'ask', 'deny']);
const toolNames = z.array(z.string().min(1).max(256).refine((value) => !/[\r\n\0]/u.test(value))).max(256);
export const BusinessOpencodeAgentOptionsSchema = z.strictObject({
  description: text.optional(), mode: z.enum(['primary', 'subagent', 'all']).optional(),
  temperature: z.number().min(0).max(2).optional(), top_p: z.number().min(0).max(1).optional(),
  steps: z.number().int().positive().max(100_000).optional(), maxSteps: z.number().int().positive().max(100_000).optional(),
  variant: z.string().min(1).max(128).optional(), hidden: z.boolean().optional(),
  tools: z.record(key, z.boolean()).optional(),
  permission: z.union([permissionAction, z.record(key, z.union([permissionAction, z.record(key, permissionAction)]))]).optional(),
});
export const BusinessClaudeAgentOptionsSchema = z.strictObject({
  description: text.optional(), tools: toolNames.optional(), disallowedTools: toolNames.optional(),
  permissionMode: z.enum(['default', 'acceptEdits', 'dontAsk', 'plan', 'bypassPermissions']).optional(),
  maxTurns: z.number().int().positive().max(100_000).optional(), effort: z.enum(['low', 'medium', 'high', 'max']).optional(),
  skills: z.array(BusinessNativeNameSchema).max(32).optional(),
});
const options = z.preprocess((value, ctx) => {
  const visit = (input: unknown, depth: number): boolean => {
    if (depth > 16) return false;
    if (!input || typeof input !== 'object') return true;
    return Object.entries(input).every(([name, nested]) => !forbiddenKeys.has(name) && visit(nested, depth + 1));
  };
  if (!visit(value, 0)) ctx.addIssue({ code: 'custom', message: '配置包含原型键或超过嵌套上限' });
  return value;
}, z.record(key, z.json()));
const agent = z.strictObject({ name: BusinessNativeNameSchema, body: z.string().max(1024 * 1024), options: options.default({}) });
const oauth = z.union([z.literal(false), z.strictObject({ clientId: text.optional(), clientSecret: text.optional(), scope: text.optional(), redirectUri: z.url().refine((value) => ['http:', 'https:'].includes(new URL(value).protocol)).optional() })]);
const mcpEnvironmentName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).max(128).refine((name) => !forbiddenKeys.has(name) && BusinessEnvironmentNameSchema.safeParse(name.toUpperCase()).success, '不能覆盖平台或驱动保留的环境变量');
const mcp = z.discriminatedUnion('type', [
  z.strictObject({ name: BusinessNativeNameSchema, type: z.literal('remote'), url: z.url().refine((value) => { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; }, 'MCP URL 必须是无内嵌凭据的 HTTP(S) 地址'), headers: z.record(key, text).optional(), oauth: oauth.optional(), timeoutMs: z.number().int().min(1).max(600_000).optional() }),
  z.strictObject({ name: BusinessNativeNameSchema, type: z.literal('local'), command: z.array(text).min(1).max(128).refine((value) => !!value[0]), env: z.record(mcpEnvironmentName, text).optional(), timeoutMs: z.number().int().min(1).max(600_000).optional() }),
]);
const plugin = z.strictObject({
  name: BusinessNativeNameSchema, entry: BusinessRelativePathSchema,
  files: z.array(BusinessPluginFileSchema).min(1).max(BUSINESS_NATIVE_MATERIAL_LIMITS.files), options: options.optional(),
}).superRefine((value, ctx) => { const issue = materialTreeIssue(value.files, value.entry); if (issue) ctx.addIssue({ code: 'custom', message: issue, path: ['files'] }); });
export const BusinessNativeConfigSchema = z.strictObject({
  version: z.literal(1), protocol: z.enum(['opencode', 'claude-code']), agent,
  subagents: z.array(agent).max(128).default([]), mcp: z.array(mcp).max(64).default([]), plugins: z.array(plugin).max(128).default([]),
}).superRefine((value, ctx) => {
  const schema = value.protocol === 'opencode' ? BusinessOpencodeAgentOptionsSchema : BusinessClaudeAgentOptionsSchema;
  for (const [i, definition] of [value.agent, ...value.subagents].entries()) {
    const parsed = schema.safeParse(definition.options);
    if (!parsed.success) for (const issue of parsed.error.issues) {
      const prefix = [...(i === 0 ? ['agent'] : ['subagents', i - 1]), 'options', ...issue.path];
      for (const path of issue.code === 'unrecognized_keys' ? issue.keys.map((key) => [...prefix, key]) : [prefix]) ctx.addIssue({ code: 'custom', message: '当前协议不支持或不允许此 Agent 选项', path });
    }
    if (value.protocol === 'opencode' && (i === 0 && definition.options.mode === 'subagent' || i > 0 && definition.options.mode === 'primary')) ctx.addIssue({ code: 'custom', message: 'Agent 入口与声明模式不匹配', path: [...(i === 0 ? ['agent'] : ['subagents', i - 1]), 'options', 'mode'] });
  }
  for (const [name, entries] of [['agents', [value.agent, ...value.subagents]], ['mcp', value.mcp], ['plugins', value.plugins]] as const) {
    if (new Set(entries.map((entry) => entry.name)).size !== entries.length) ctx.addIssue({ code: 'custom', message: '名称重复', path: [name] });
  }
  if (value.protocol === 'claude-code') for (const [i, item] of value.mcp.entries()) if (item.timeoutMs !== undefined) ctx.addIssue({ code: 'custom', message: 'Claude 不支持逐 MCP timeoutMs', path: ['mcp', i, 'timeoutMs'] });
  if (value.protocol === 'claude-code') {
    for (const [i, item] of value.mcp.entries()) if (item.type === 'remote' && item.oauth !== undefined) ctx.addIssue({ code: 'custom', message: '当前协议不支持 MCP oauth', path: ['mcp', i, 'oauth'] });
    for (const [i, item] of value.plugins.entries()) if (item.options && Object.keys(item.options).length) ctx.addIssue({ code: 'custom', message: '当前协议不支持插件 options', path: ['plugins', i, 'options'] });
  }

});
export type BusinessNativeConfig = z.infer<typeof BusinessNativeConfigSchema>;
