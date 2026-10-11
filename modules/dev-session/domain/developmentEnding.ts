import { z } from 'zod';
import { DevelopmentUsageClosureSchema, DevelopmentUsageDrainReasonSchema, DevelopmentUsageReceiptSchema, DevelopmentUsageRegistrationSchema, DevelopmentUsageStopReceiptSchema, StoredDevelopmentUsageSchema, TaskIdSchema } from '@crewstation/contracts';
import type { DevelopmentUsageRegistration } from '@crewstation/contracts';
import { conflict, jsonHash, precondition } from '@crewstation/kernel';
import { developmentReceiptMatches } from './developmentDispatch';
import { DevelopmentPrestartCleanupEvidenceSchema } from './development/prestartCleanup';

const instant = z.iso.datetime().transform((s) => new Date(s).toISOString());
export const DEVELOPMENT_ENDING_BATCH = 32;
export const DEVELOPMENT_ENDING_LEASE_MS = 30_000;
export const DevelopmentEndingRequestSchema = z.strictObject({
  executionTaskId: TaskIdSchema, expectedRegistration: DevelopmentUsageRegistrationSchema.nullable(),
  reason: DevelopmentUsageDrainReasonSchema, observedAt: instant, receipt: DevelopmentUsageReceiptSchema.optional(),
}).superRefine((value, ctx) => {
  if (['forced-release', 'environment-lost'].includes(value.reason)) ctx.addIssue({ code: 'custom', message: '强制/实际 Pod 丢失证明尚未接入本批结束请求' });
  if (value.receipt && (!value.expectedRegistration || !developmentReceiptMatches(value.expectedRegistration, value.receipt) || value.receipt.phase !== 'finished'))
    ctx.addIssue({ code: 'custom', message: '逻辑终态必须匹配原数字登记' });
  if (['completed', 'error'].includes(value.reason) && value.receipt?.result !== value.reason)
    ctx.addIssue({ code: 'custom', message: '完成或错误请求需要对应实际终态回执' });
  if (value.expectedRegistration && value.expectedRegistration.runtimeTaskId !== value.executionTaskId)
    ctx.addIssue({ code: 'custom', message: '结束请求必须绑定实际执行环境' });
});
export const DevelopmentEndingJobSchema = z.strictObject({
  executionTaskId: TaskIdSchema, firstReason: DevelopmentUsageDrainReasonSchema, observedAt: instant,
  logicalResult: z.enum(['completed', 'error', 'cancelled']).nullable(), actualEndedAt: z.null(),
  version: z.number().int().positive(), fence: z.number().int().nonnegative(), leaseUntil: instant.nullable(), lastAttemptAt: instant,
  stop: DevelopmentUsageStopReceiptSchema.nullable(), closure: DevelopmentUsageClosureSchema.nullable(),
  prestartClosure: DevelopmentPrestartCleanupEvidenceSchema.nullable().default(null),
  stage: z.enum(['awaiting-stop', 'awaiting-closure', 'evidence-complete', 'prestart-closed']),
}).superRefine((value, ctx) => {
  if (value.stage === 'prestart-closed') {
    if (value.stop !== null || value.closure !== null || value.logicalResult !== null || value.prestartClosure?.phase !== 'closed'
      || value.prestartClosure.selection.identity.executionId !== value.executionTaskId || value.prestartClosure.owner.firstReason !== value.firstReason)
      ctx.addIssue({ code: 'custom', message: '未获准启动终态需要独立原物理闭合，不能制造数字或实际结束时间' });
    return;
  }
  if (value.prestartClosure !== null) ctx.addIssue({ code: 'custom', message: '原数字结束阶段不能混入未获准启动物理闭合' });
  const stage = !value.stop ? 'awaiting-stop' : !value.closure ? 'awaiting-closure' : 'evidence-complete';
  if (value.stage !== stage || (value.stop && !['prevented', 'finished'].includes(value.stop.state)))
    ctx.addIssue({ code: 'custom', message: '结束阶段需要独立停止与排空证据' });
  if (value.stop && value.logicalResult !== value.stop.receipt.result) ctx.addIssue({ code: 'custom', message: '停止与逻辑实际结果冲突' });
});
export const DevelopmentEndingEvidenceSchema = z.strictObject({
  observedAt: instant, stored: StoredDevelopmentUsageSchema, stop: DevelopmentUsageStopReceiptSchema.nullable(),
});
export type DevelopmentEndingRequest = z.infer<typeof DevelopmentEndingRequestSchema>;
export type DevelopmentEndingJob = z.infer<typeof DevelopmentEndingJobSchema>;
export type DevelopmentEndingEvidence = z.infer<typeof DevelopmentEndingEvidenceSchema>;
export interface DevelopmentEndingLease { job: DevelopmentEndingJob; registration: DevelopmentUsageRegistration | null }

export function developmentEndingStored(registration: DevelopmentUsageRegistration, raw: unknown) {
  const parsed = StoredDevelopmentUsageSchema.safeParse(raw);
  if (!parsed.success || jsonHash(parsed.data.registration) !== jsonHash(registration)) throw conflict('结束恢复的 Session 原登记不匹配');
  return parsed.data;
}
export function developmentEndingDeadline(now: string): string {
  return new Date(Date.parse(instant.parse(now)) + DEVELOPMENT_ENDING_LEASE_MS).toISOString();
}
export function mergeDevelopmentEnding(job: DevelopmentEndingJob, registration: DevelopmentUsageRegistration, raw: DevelopmentEndingEvidence): DevelopmentEndingJob {
  if (job.stage === 'prestart-closed') throw conflict('未获准启动终态不能重新打开数字结束');
  const input = DevelopmentEndingEvidenceSchema.parse(raw), stored = developmentEndingStored(registration, input.stored);
  if (input.stop && !developmentReceiptMatches(registration, input.stop.receipt)) throw conflict('停止回执不是原执行');
  const stop = input.stop && ['prevented', 'finished'].includes(input.stop.state) ? input.stop : null;
  const logical = stop?.receipt.result ?? (stored.receipt?.phase === 'finished' ? stored.receipt.result : null);
  if (logical && ((job.logicalResult && job.logicalResult !== logical) || (stored.receipt?.phase === 'finished' && stored.receipt.result !== logical)))
    throw conflict('原执行实际结果不能替换');
  if (job.stop && stop && (job.stop.state !== stop.state || job.stop.receipt.result !== stop.receipt.result)) throw conflict('原停止证据不能替换');
  if (job.closure && stored.closure && jsonHash(job.closure) !== jsonHash(stored.closure)) throw conflict('原排空证据不能替换');
  if (stored.closure && !stored.drainReason) throw precondition('结束数字闭合需要独立已持久 drain');
  const nextStop = job.stop ?? stop, closure = job.closure ?? stored.closure;
  return DevelopmentEndingJobSchema.parse({ ...job, logicalResult: job.logicalResult ?? logical, stop: nextStop, closure,
    stage: !nextStop ? 'awaiting-stop' : !closure ? 'awaiting-closure' : 'evidence-complete' });
}
