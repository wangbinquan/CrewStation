import { ComputeProfileSelectorSchema } from '../api/compute/computeProfile';
import { z } from 'zod';
import { ResourceIdSchema } from '../ids';

/** 业务侧的抽象权限，驱动层映射为各 CLI 的标志。 */
export const AgentPermissionSchema = z.enum(['read-only', 'edit', 'full']);
export const VolumeModeSchema = z.enum(['follow-container', 'persistent']);

/**
 * Agent 档案（RFC-001）：算力由平台统一提供，业务不声明厂商、模型与驱动，只引用管理员定义的档位名；
 * RFC-006：也可以写 `default`，每次启动时解析到管理员设为默认的档位。
 * `.strict()` 是必需的：zod 默认剥掉未知键，旧写法的 `driver` / `model` 会被静默丢弃，
 * 业务会以为自己指定了驱动，实际没有；strict 之后会明确报出「无法识别的键 driver」。
 */
export const AgentProfileSchema = z.object({
  id: ResourceIdSchema,
  name: z.string().trim().min(1).max(80),
  /** 管理员定义的算力档位名，或 `default`；档位封装协议、镜像、二进制、启动前步骤与模型（RFC-006）。 */
  compute: ComputeProfileSelectorSchema,
  permission: AgentPermissionSchema.default('edit'),
  /** 相对仓库根的系统提示文件，可选。 */
  systemPromptFile: z.string().min(1).optional(),
}).strict();

export const OutputContractSchema = z.object({
  id: ResourceIdSchema,
  name: z.string().trim().min(1).max(80),
  /** 子任务结束时必须存在的相对路径。 */
  required: z.array(z.string().min(1)).default([]),
  /** 相对仓库根的 JSON Schema 文件，用于校验 required 中的 JSON 产物。 */
  schema: z.string().min(1).optional(),
});

export const TasksSpecSchema = z.object({
  /** 管理员定义的任务容器套餐。 */
  taskProfileId: ResourceIdSchema,
  defaultVolumeMode: VolumeModeSchema.default('follow-container'),
  agentProfiles: z.array(AgentProfileSchema).default([]),
  outputContracts: z.array(OutputContractSchema).default([]),
}).refine((t) => new Set(t.agentProfiles.map((p) => p.id)).size === t.agentProfiles.length, 'agentProfiles ID 重复')
  .refine((t) => new Set(t.outputContracts.map((c) => c.id)).size === t.outputContracts.length, 'outputContracts ID 重复');

export type AgentPermission = z.infer<typeof AgentPermissionSchema>;
export type VolumeMode = z.infer<typeof VolumeModeSchema>;
export type AgentProfile = z.infer<typeof AgentProfileSchema>;
export type OutputContract = z.infer<typeof OutputContractSchema>;
export type TasksSpec = z.infer<typeof TasksSpecSchema>;
