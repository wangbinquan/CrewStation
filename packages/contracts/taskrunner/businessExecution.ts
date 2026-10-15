import { AgentEventSchema } from './agentEvents';
import { z } from 'zod';
import { TaskIdSchema } from '../ids';
import { BusinessDirectoryQuerySchema, BusinessFileQuerySchema } from '../api/business/files';
import { BusinessCommandEnvironmentSchema } from '../api/business/requests';

const ExecutionId = z.string().min(1).max(128);
const Sequence = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const command = <T extends string>(type: T) => ({ id: z.string().min(1), type: z.literal(type) });

export const BusinessExecutionResultSchema = z.object({
  exitCode: z.number().int().nullable(),
  reason: z.enum(['exited', 'cancelled', 'timeout', 'spawn_failed', 'output_limit', 'event_persistence_failed', 'agent_failed']),
  durationMs: Sequence,
}).strict();
export const BusinessExecutionReceiptSchema = z.object({
  executionId: ExecutionId, attempt: z.number().int().positive(), payloadDigest: z.string().regex(/^[a-f0-9]{64}$/),
  incarnation: z.uuid(), phase: z.enum(['registered', 'running', 'cancelling', 'finished', 'unknown']),
  lastSequence: Sequence, acknowledgedSequence: Sequence, outputBytes: Sequence,
  result: BusinessExecutionResultSchema.nullable(),
}).strict();
export const BusinessExecutionFrameSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('agent'), event: AgentEventSchema.omit({ raw: true }).strict() }).strict(),
  z.object({ type: z.literal('output'), stream: z.enum(['stdout', 'stderr']), text: z.string() }).strict(),
  z.object({ type: z.literal('state'), state: z.enum(['running', 'cancelling']) }).strict(),
  z.object({ type: z.literal('result'), result: BusinessExecutionResultSchema }).strict(),
]);
export const BusinessExecutionEventSchema = z.object({ sequence: Sequence, occurredAt: z.iso.datetime(), frame: BusinessExecutionFrameSchema }).strict();
export const BusinessExecutionInfoSchema = z.object({
  incarnation: z.uuid(), limits: z.object({ outputBytes: Sequence, spoolBytes: Sequence, eventBytes: Sequence }).strict(),
}).strict();
export type RunnerBusinessReceipt = z.infer<typeof BusinessExecutionReceiptSchema>;
export type RunnerBusinessEvent = z.infer<typeof BusinessExecutionEventSchema>;
export type RunnerBusinessResult = z.infer<typeof BusinessExecutionResultSchema>;
export const StoredBusinessExecutionSchema = z.object({ taskId: TaskIdSchema, receipt: BusinessExecutionReceiptSchema,
  persistedThrough: Sequence, acknowledgedThrough: Sequence, complete: z.boolean() }).strict();
export type StoredBusinessExecutionDto = z.infer<typeof StoredBusinessExecutionSchema>;

/** 与旧 exec 分开，避免把仅有内存重放的旧 Runner 误判成可靠执行。 */
export const BusinessExecutionCommands = [
  z.object({ ...command('businessExecutionInfo') }).strict(),
  z.object({ ...command('startBusinessCommand'), executionId: ExecutionId, attempt: z.number().int().positive(),
    incarnation: z.uuid(), payloadDigest: z.string().regex(/^[a-f0-9]{64}$/),
    command: z.array(z.string().max(32768).refine((value) => !value.includes('\0'))).min(1).max(1024),
    cwd: z.string().optional(), env: BusinessCommandEnvironmentSchema.default({}),
    timeoutSeconds: z.number().int().min(1).max(86400).default(3600),
  }).strict(),
  z.object({ ...command('getBusinessExecution'), executionId: ExecutionId }).strict(),
  z.object({ ...command('cancelBusinessExecution'), executionId: ExecutionId, registration: z.object({ attempt: z.number().int().positive(), payloadDigest: z.string().regex(/^[a-f0-9]{64}$/), incarnation: z.uuid() }).strict().optional() }).strict(),
  z.object({ ...command('readBusinessExecutionEvents'), executionId: ExecutionId, after: Sequence, limit: z.number().int().min(1).max(1000).default(200) }).strict(),
  z.object({ ...command('ackBusinessExecutionEvents'), executionId: ExecutionId, through: Sequence }).strict(),
  z.object({ ...command('readBusinessFile'), query: BusinessFileQuerySchema }).strict(),
  z.object({ ...command('listBusinessFiles'), query: BusinessDirectoryQuerySchema }).strict(),
] as const;

/** Canonical command bytes shared by admission and Runner; no secret values are logged. */
export function businessCommandDigestInput(input: { command: string[]; cwd?: string; env: Record<string, string>; timeoutSeconds: number }): string {
  return JSON.stringify({ command: input.command, cwd: input.cwd ?? '.', env: Object.fromEntries(Object.entries(input.env).sort(([a], [b]) => a.localeCompare(b))), timeoutSeconds: input.timeoutSeconds });
}

/** Text contributes to the common output budget; metadata has a separate per-event/spool ceiling. */
export function businessFrameOutputBytes(frame: z.infer<typeof BusinessExecutionFrameSchema>): number {
  const text = frame.type === 'output' ? frame.text : frame.type === 'agent' && frame.event.type === 'text' ? frame.event.text ?? '' : '';
  return new TextEncoder().encode(text).byteLength;
}

/** A private per-attempt nonce prevents published digests becoming an oracle for secret values. */
export function businessAgentDigestInput(agent: unknown, digestNonce: string): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
    return value;
  };
  return JSON.stringify({ nonce: digestNonce, agent: canonical(agent) });
}
