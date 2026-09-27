import { z } from 'zod';
import { ResourceIdSchema } from '../ids';
import { BusinessEnvironmentNameSchema } from '../api/business/executionValues';

const connection = z.strictObject({
  id: ResourceIdSchema, name: z.string().min(1).max(80), url: z.url().refine((value) => /^https?:\/\//.test(value), 'MCP 只支持 HTTP(S)'),
  secretHeaders: z.record(z.string().min(1).max(128), ResourceIdSchema).default({}),
  allowedParameterKeys: z.array(z.string().min(1).max(128)).max(128).default([]),
});
export const BusinessConfigSchema = z.strictObject({
  allowSystemPromptAppend: z.boolean().default(false), allowSkills: z.boolean().default(false),
  allowedEnvNames: z.array(BusinessEnvironmentNameSchema).max(128).default([]),
  mcpConnections: z.array(connection).max(64).default([]),
}).refine((value) => new Set(value.allowedEnvNames).size === value.allowedEnvNames.length, '环境变量名重复')
  .refine((value) => new Set(value.mcpConnections.map((mcp) => mcp.id)).size === value.mcpConnections.length, 'MCP ID 重复')
  .refine((value) => new Set(value.mcpConnections.map((mcp) => mcp.name)).size === value.mcpConnections.length, 'MCP 名称重复');

export type BusinessConfig = z.infer<typeof BusinessConfigSchema>;
