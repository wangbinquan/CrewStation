import { z } from 'zod';
import { SlugSchema } from '../ids';

export const AgentDriverSchema = z.enum(['claude-code', 'opencode', 'stub']);
/** 业务侧的抽象权限，驱动层映射为各 CLI 的标志。 */
export const AgentPermissionSchema = z.enum(['read-only', 'edit', 'full']);
export const VolumeModeSchema = z.enum(['follow-container', 'persistent']);

export const AgentProfileSchema = z.object({
  name: SlugSchema,
  driver: AgentDriverSchema,
  /** `<provider>/<model>`，与 agent-workflow 的写法一致。 */
  model: z.string().min(1),
  permission: AgentPermissionSchema.default('edit'),
  /** 相对仓库根的系统提示文件，可选。 */
  systemPromptFile: z.string().min(1).optional(),
});

export const OutputContractSchema = z.object({
  name: SlugSchema,
  /** 子任务结束时必须存在的相对路径。 */
  required: z.array(z.string().min(1)).default([]),
  /** 相对仓库根的 JSON Schema 文件，用于校验 required 中的 JSON 产物。 */
  schema: z.string().min(1).optional(),
});

export const TasksSpecSchema = z.object({
  /** 管理员定义的任务容器套餐。 */
  profile: SlugSchema,
  defaultVolumeMode: VolumeModeSchema.default('follow-container'),
  agentProfiles: z.array(AgentProfileSchema).default([]),
  outputContracts: z.array(OutputContractSchema).default([]),
}).refine((t) => new Set(t.agentProfiles.map((p) => p.name)).size === t.agentProfiles.length, 'agentProfiles 名称重复')
  .refine((t) => new Set(t.outputContracts.map((c) => c.name)).size === t.outputContracts.length, 'outputContracts 名称重复');

export type AgentDriver = z.infer<typeof AgentDriverSchema>;
export type AgentPermission = z.infer<typeof AgentPermissionSchema>;
export type VolumeMode = z.infer<typeof VolumeModeSchema>;
export type AgentProfile = z.infer<typeof AgentProfileSchema>;
export type OutputContract = z.infer<typeof OutputContractSchema>;
export type TasksSpec = z.infer<typeof TasksSpecSchema>;
