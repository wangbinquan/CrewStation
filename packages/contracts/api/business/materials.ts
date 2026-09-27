import { z } from 'zod';
import { ResourceIdSchema } from '../../ids';
import { BusinessExecutionFenceSchema } from './control';
import { BUSINESS_EXECUTION_LIMITS, BusinessDigestSchema, BusinessEnvironmentNameSchema, BusinessRelativePathSchema, BusinessRequestKeySchema } from './executionValues';

export const BusinessSecretReferenceSchema = z.strictObject({ configDefinitionId: ResourceIdSchema });
export const BusinessEnvironmentValueSchema = z.union([z.string().max(32768).refine((value) => !value.includes('\0'), '环境变量值不能含 NUL'), z.strictObject({ secret: BusinessSecretReferenceSchema })]);
export const BusinessMcpMaterialSchema = z.strictObject({ connectionId: ResourceIdSchema, parameters: z.record(z.string().max(128), z.string().max(4096)).default({}) });
export const BusinessSkillFileSchema = z.strictObject({ path: BusinessRelativePathSchema, content: z.string().max(BUSINESS_EXECUTION_LIMITS.materialBytes) });

export const BusinessMaterialRequestSchema = z.strictObject({
  requestKey: BusinessRequestKeySchema, fence: BusinessExecutionFenceSchema.optional(),
  systemPrompt: z.string().max(BUSINESS_EXECUTION_LIMITS.materialBytes).optional(),
  skills: z.array(BusinessSkillFileSchema).max(BUSINESS_EXECUTION_LIMITS.materialFiles).default([]),
  mcp: z.array(BusinessMcpMaterialSchema).max(64).default([]),
  env: z.record(BusinessEnvironmentNameSchema, BusinessEnvironmentValueSchema).default({}),
  subagents: z.array(z.strictObject({ name: z.string().min(1).max(80), agentProfileId: ResourceIdSchema, description: z.string().max(4096) })).max(128).default([]),
}).superRefine((value, ctx) => {
  const { fence: _fence, requestKey: _key, ...material } = value;
  if (new TextEncoder().encode(JSON.stringify(material)).byteLength > BUSINESS_EXECUTION_LIMITS.materialBytes) ctx.addIssue({ code: 'custom', message: '执行材料超过字节上限' });
  if (new Set(value.skills.map((file) => file.path)).size !== value.skills.length) ctx.addIssue({ code: 'custom', path: ['skills'], message: 'skills 路径重复' });
  if (new Set(value.mcp.map((mcp) => mcp.connectionId)).size !== value.mcp.length) ctx.addIssue({ code: 'custom', path: ['mcp'], message: 'MCP 引用重复' });
  if (new Set(value.subagents.map((agent) => agent.name)).size !== value.subagents.length) ctx.addIssue({ code: 'custom', path: ['subagents'], message: '子代理名称重复' });
});
export const BusinessMaterialDtoSchema = z.strictObject({ materialId: ResourceIdSchema, digest: BusinessDigestSchema, sizeBytes: z.number().int().min(0), createdAt: z.iso.datetime() });

export type BusinessMaterialRequest = z.infer<typeof BusinessMaterialRequestSchema>;
export type BusinessMaterialDto = z.infer<typeof BusinessMaterialDtoSchema>;
export type BusinessEnvironmentValue = z.infer<typeof BusinessEnvironmentValueSchema>;

export type BusinessMaterialRequestInput = z.input<typeof BusinessMaterialRequestSchema>;
