import { z } from 'zod';
import { ResourceIdSchema } from '../../ids';
import { RuntimeImageArchitectureSchema } from './values';

const ResourcesSchema = z.object({ cpu: z.string().min(1), memory: z.string().min(1), ephemeralStorage: z.string().min(1) }).strict();
// 平台生成的脚本包含已转义的构建参数；普通工具 argv 仍使用 8192 字符限制。
const BuildCommandSchema = z.array(z.string().min(1).refine((value) => !value.includes('\0') && new TextEncoder().encode(value).length <= 65536, '构建命令参数过长或含 NUL')).min(1).max(128);
/** 资源所属模块写入台账的非秘密渲染材料；既有 release Job 合同保持独立。 */
export const RuntimeImageBuildRenderSchema = z.object({
  buildId: ResourceIdSchema, resourceId: ResourceIdSchema, executionEpoch: z.number().int().positive(),
  projectId: ResourceIdSchema.optional(), projectSlug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  namespace: z.string().regex(/^[a-z0-9][a-z0-9-]*$/), name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/), secret: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  architecture: RuntimeImageArchitectureSchema, clientImage: z.string().min(1), builderImage: z.string().min(1),
  /** 固定到本 build 专属仓库的产物地址；不能覆盖平台底座或其他构建。 */
  repository: z.string().min(1), destination: z.string().min(1),
  checkoutCommand: BuildCommandSchema, clientCommand: BuildCommandSchema, daemonCommand: BuildCommandSchema,
  /** 存在即为直接编写构建；内容从不可变修订读取，仅挂入上下文准备容器。 */
  inlineFileCount: z.number().int().min(0).max(32).optional(),
  secretIds: z.array(z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/)).max(32),
  builderResources: ResourcesSchema, clientResources: ResourcesSchema, workspaceSize: z.string().min(1), cacheSize: z.string().min(1),
  activeDeadlineSeconds: z.number().int().positive(), ttlSecondsAfterFinished: z.number().int().positive(),
}).strict();
export type RuntimeImageBuildRender = z.infer<typeof RuntimeImageBuildRenderSchema>;
