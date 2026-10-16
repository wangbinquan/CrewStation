import { z } from 'zod';
import { BusinessNativeConfigSchema } from './nativeConfig';
import { BusinessMaterialFileSchema, BUSINESS_NATIVE_MATERIAL_LIMITS, businessMaterialAccounting, materialTreeIssue, type BusinessMaterialObject } from './materialFiles';
import { ResourceIdSchema } from '../../ids';
import { BusinessExecutionFenceSchema } from './control';
import { BUSINESS_EXECUTION_LIMITS, BusinessDigestSchema, BusinessEnvironmentNameSchema, BusinessRequestKeySchema } from './executionValues';

export const BusinessSecretReferenceSchema = z.strictObject({ configDefinitionId: ResourceIdSchema });
export const BusinessEnvironmentValueSchema = z.union([z.string().max(32768).refine((value) => !value.includes('\0'), '环境变量值不能含 NUL'), z.strictObject({ secret: BusinessSecretReferenceSchema })]);
export const BusinessMcpMaterialSchema = z.strictObject({ connectionId: ResourceIdSchema, parameters: z.record(z.string().max(128), z.string().max(4096)).default({}) });
export const BusinessSkillFileSchema = BusinessMaterialFileSchema;

export const BusinessMaterialRequestSchema = z.strictObject({
  requestKey: BusinessRequestKeySchema, fence: BusinessExecutionFenceSchema.optional(),
  systemPrompt: z.string().max(BUSINESS_EXECUTION_LIMITS.materialBytes).optional(),
  skills: z.array(BusinessSkillFileSchema).max(BUSINESS_NATIVE_MATERIAL_LIMITS.files).default([]),
  nativeConfig: BusinessNativeConfigSchema.optional(),
  mcp: z.array(BusinessMcpMaterialSchema).max(64).default([]),
  env: z.record(BusinessEnvironmentNameSchema, BusinessEnvironmentValueSchema).default({}),
  subagents: z.array(z.strictObject({ name: z.string().min(1).max(80), agentProfileId: ResourceIdSchema, description: z.string().max(4096) })).max(128).default([]),
}).superRefine((value, ctx) => {
  try { businessMaterialObjects(value); } catch { ctx.addIssue({ code: 'custom', message: '同一对象的固定元数据不一致' }); }
  const files = [...value.skills, ...(value.nativeConfig?.plugins.flatMap((plugin) => plugin.files) ?? [])];
  if (files.filter((file) => 'content' in file && file.content !== undefined).length > BUSINESS_EXECUTION_LIMITS.materialFiles) ctx.addIssue({ code: 'custom', message: '内联材料文件超过数量上限', path: ['skills'] });
  const bytes = files.reduce((sum, file) => sum + ('target' in file ? 0 : file.object?.size ?? new TextEncoder().encode(file.content ?? '').byteLength), 0);
  if (files.length > BUSINESS_NATIVE_MATERIAL_LIMITS.files || bytes > BUSINESS_NATIVE_MATERIAL_LIMITS.bytes) ctx.addIssue({ code: 'custom', message: '材料文件超过数量或字节预算' });
  const issue = materialTreeIssue(value.skills.map((file) => ({ ...file, kind: 'file' as const })));
  if (issue) ctx.addIssue({ code: 'custom', message: issue, path: ['skills'] });
  const { fence: _fence, requestKey: _key, ...material } = value, size = businessMaterialAccounting(material);
  if (size.inlineBytes > BUSINESS_EXECUTION_LIMITS.materialBytes) ctx.addIssue({ code: 'custom', message: '执行材料超过字节上限' });
  if (size.descriptorBytes > BUSINESS_NATIVE_MATERIAL_LIMITS.descriptorBytes) ctx.addIssue({ code: 'custom', message: '对象文件描述超过预算' });
  if (new Set(value.skills.map((file) => file.path)).size !== value.skills.length) ctx.addIssue({ code: 'custom', path: ['skills'], message: 'skills 路径重复' });
  if (new Set(value.mcp.map((mcp) => mcp.connectionId)).size !== value.mcp.length) ctx.addIssue({ code: 'custom', path: ['mcp'], message: 'MCP 引用重复' });
  if (new Set(value.subagents.map((agent) => agent.name)).size !== value.subagents.length) ctx.addIssue({ code: 'custom', path: ['subagents'], message: '子代理名称重复' });
});
export const BusinessMaterialDtoSchema = z.strictObject({ materialId: ResourceIdSchema, digest: BusinessDigestSchema, sizeBytes: z.number().int().min(0), createdAt: z.iso.datetime() });

export type BusinessMaterialRequest = z.infer<typeof BusinessMaterialRequestSchema>;
export type BusinessMaterialDto = z.infer<typeof BusinessMaterialDtoSchema>;
export type BusinessEnvironmentValue = z.infer<typeof BusinessEnvironmentValueSchema>;

export type BusinessMaterialRequestInput = z.input<typeof BusinessMaterialRequestSchema>;

/** Immutable descriptors only. Expiring transfer authorization never enters the business material. */
export function businessMaterialObjects(material: Pick<BusinessMaterialRequest, 'skills' | 'nativeConfig'>): BusinessMaterialObject[] {
  const files = [...material.skills, ...(material.nativeConfig?.plugins.flatMap((plugin) => plugin.files) ?? [])];
  const refs = new Map<string, BusinessMaterialObject>();
  for (const file of files) if ('object' in file && file.object) {
    const prior = refs.get(file.object.objectId);
    if (prior && (prior.sha256 !== file.object.sha256 || prior.size !== file.object.size)) throw new Error('material-object-metadata-conflict');
    refs.set(file.object.objectId, file.object);
  }
  return [...refs.values()].sort((a, b) => a.objectId.localeCompare(b.objectId));
}
