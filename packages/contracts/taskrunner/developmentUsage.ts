import { z } from 'zod';
import { ProjectIdSchema, ResourceIdSchema, TaskIdSchema } from '../ids';
import { DevelopmentUsageIdentitySchema } from '../api/observability/usageLedger';
import { AgentPermissionSchema } from '../manifest/tasks';
import { LaunchSpecSchema } from './launch';
import { RunnerUsageCaptureSchema } from './usageObservation';

const sequence = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const DEVELOPMENT_USAGE_LIMITS = { capturesPerPage: 5, pageBytes: 1024 * 1024, spoolBytes: 64 * 1024 * 1024 } as const;
export const DEVELOPMENT_USAGE_DIRECTORY = '/run/crewstation/development-usage';
export const DEVELOPMENT_USAGE_BINDING_DIRECTORY = '/run/crewstation/development-usage-binding';
export const DevelopmentUsageRuntimeConfigSchema = z.strictObject({ version: z.literal(1), directory: z.literal(DEVELOPMENT_USAGE_DIRECTORY), bindingDirectory: z.literal(DEVELOPMENT_USAGE_BINDING_DIRECTORY), projectId: ProjectIdSchema, workspaceTaskId: TaskIdSchema });
export type DevelopmentUsageRuntimeConfig = z.infer<typeof DevelopmentUsageRuntimeConfigSchema>;
export const DevelopmentAgentIdentitySchema = DevelopmentUsageIdentitySchema.extend({ sourceKind: z.literal('development-agent'), executionGeneration: z.literal(1) });
/** Immutable owner intent. Signed tokens, decrypted material and ordinary output are excluded. */
export const DevelopmentStartIntentSchema = z.strictObject({
  version: z.literal(1), identity: DevelopmentAgentIdentitySchema,
  profileId: ResourceIdSchema, profileRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  launch: LaunchSpecSchema, permission: AgentPermissionSchema, mode: z.enum(['oneshot', 'interactive']),
  initialPrompt: z.string().nullable(), cwd: z.string().nullable(), resumeSessionId: z.string().nullable(), systemPrompt: z.string().nullable(),
  mcp: z.array(z.strictObject({ name: z.string().min(1), url: z.url() })).max(100),
  nativeUsageLineageKey: z.string().min(1).max(512),
});
export const DevelopmentUsageKeySchema = z.strictObject({
  executionId: ResourceIdSchema, journalId: z.uuid(), incarnation: z.uuid(), payloadDigest: z.string().regex(/^[a-f0-9]{64}$/),
});
export const DevelopmentUsageStoreBindingSchema = z.strictObject({ version: z.literal(1), journalId: DevelopmentUsageKeySchema.shape.journalId, runtimeTaskId: TaskIdSchema, workspaceTaskId: TaskIdSchema, projectId: ProjectIdSchema, podUid: z.string().min(1).max(128) });
export const DevelopmentUsageAdmissionSchema = z.strictObject({
  intent: DevelopmentStartIntentSchema, key: DevelopmentUsageKeySchema, digestNonce: z.string().regex(/^[a-f0-9]{64}$/),
}).refine((value) => value.key.executionId === value.intent.identity.executionId, '启动键必须绑定实际执行环境');
export const DevelopmentUsageInterruptionSchema = z.enum(['journal-unavailable', 'journal-corrupt', 'journal-limit', 'invalid-capture', 'runner-restarted', 'missing-terminal']);
export const DevelopmentUsageReceiptSchema = z.strictObject({
  key: DevelopmentUsageKeySchema, podUid: z.string().min(1).max(128), identity: DevelopmentAgentIdentitySchema,
  profileId: ResourceIdSchema, profileRevision: z.number().int().positive(),
  phase: z.enum(['registered', 'running', 'finished', 'unknown']), lastSequence: sequence, acknowledgedSequence: sequence,
  finalThrough: sequence.nullable(), result: z.enum(['completed', 'error', 'cancelled']).nullable(),
  interruption: DevelopmentUsageInterruptionSchema.nullable(),
}).superRefine((value, ctx) => {
  if (value.key.executionId !== value.identity.executionId) ctx.addIssue({ code: 'custom', message: '回执必须绑定同一实际执行环境' });
  if ((value.phase === 'finished') !== (value.result !== null)) ctx.addIssue({ code: 'custom', message: '执行终态必须有实际结果' });
  if (value.acknowledgedSequence > value.lastSequence) ctx.addIssue({ code: 'custom', message: '确认水位不能超过持久数字水位' });
  if (value.finalThrough !== null && (value.phase !== 'finished' || value.interruption !== null || value.finalThrough !== value.lastSequence)) ctx.addIssue({ code: 'custom', message: '完整结束只能指向已持久的连续数字末尾' });
});
export const DevelopmentUsageInfoSchema = z.strictObject({
  version: z.literal(1), runtimeTaskId: TaskIdSchema, podUid: z.string().min(1).max(128), journalId: z.uuid(), incarnation: z.uuid(), receipt: DevelopmentUsageReceiptSchema.nullable(),
});
export const DevelopmentUsageEventSchema = z.strictObject({ sequence: sequence.refine((value) => value > 0), occurredAt: z.iso.datetime().max(64), capture: RunnerUsageCaptureSchema });
export const DevelopmentUsagePageSchema = z.strictObject({ key: DevelopmentUsageKeySchema, after: sequence, through: sequence, events: z.array(DevelopmentUsageEventSchema).max(DEVELOPMENT_USAGE_LIMITS.capturesPerPage) }).superRefine((value, ctx) => {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > DEVELOPMENT_USAGE_LIMITS.pageBytes) ctx.addIssue({ code: 'custom', message: '数值页超过字节上限' });
  if (value.through !== value.after + value.events.length || value.events.some((event, index) => event.sequence !== value.after + index + 1)) ctx.addIssue({ code: 'custom', message: '数值页必须连续，不能跳过记录' });
});
const command = <T extends string>(type: T) => ({ id: z.string().min(1), type: z.literal(type) });
export const DevelopmentUsageCommands = [
  z.strictObject({ ...command('developmentUsageInfo'), key: DevelopmentUsageKeySchema.optional() }),
  z.strictObject({ ...command('readDevelopmentUsageEvents'), key: DevelopmentUsageKeySchema, after: sequence, limit: z.number().int().min(1).max(DEVELOPMENT_USAGE_LIMITS.capturesPerPage).default(DEVELOPMENT_USAGE_LIMITS.capturesPerPage) }),
  z.strictObject({ ...command('ackDevelopmentUsageEvents'), key: DevelopmentUsageKeySchema, through: sequence }),
] as const;
export type DevelopmentStartIntent = z.infer<typeof DevelopmentStartIntentSchema>;
export type DevelopmentUsageAdmission = z.infer<typeof DevelopmentUsageAdmissionSchema>;
export type DevelopmentUsageKey = z.infer<typeof DevelopmentUsageKeySchema>;
export type DevelopmentUsageReceipt = z.infer<typeof DevelopmentUsageReceiptSchema>;
export type DevelopmentUsageInfo = z.infer<typeof DevelopmentUsageInfoSchema>;
export type DevelopmentUsageEvent = z.infer<typeof DevelopmentUsageEventSchema>;
export type DevelopmentUsagePage = z.infer<typeof DevelopmentUsagePageSchema>;
export type DevelopmentUsageInterruption = z.infer<typeof DevelopmentUsageInterruptionSchema>;
