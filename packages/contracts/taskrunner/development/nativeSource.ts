import { z } from 'zod';
import { RunnerUsageCaptureSchema } from '../usageObservation';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const key = z.string().min(1).max(512);
export const DevelopmentNativeStoreSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('pending') }),
  z.strictObject({ state: z.literal('unavailable') }),
  z.strictObject({ state: z.literal('observed'), sourceEpoch: z.uuid(), actualPathDigest: digest, fileIdentityDigest: digest }),
]);
export const DevelopmentNativeSourceIssueSchema = z.enum(['native-source-path-unavailable', 'native-source-stat-unavailable', 'native-source-read-failed', 'native-source-changed', 'native-source-sidecar-unavailable', 'native-source-unsupported']);
/** Observed metadata, not an attestation of the upstream SQLite file descriptor. */
export const DevelopmentNativeSourceSchema = z.strictObject({
  version: z.literal(1), stage: z.enum(['begin', 'finish']), lineageKey: key, turn: key,
  turnIndex: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), observedAt: z.iso.datetime(),
  plannedPathDigest: digest.nullable(), scope: z.enum(['execution-local', 'unverified']),
  beginStore: DevelopmentNativeStoreSchema, finalStore: DevelopmentNativeStoreSchema.nullable(),
  continuity: z.enum(['same', 'new', 'changed', 'unverified']), issues: z.array(DevelopmentNativeSourceIssueSchema).max(6),
}).superRefine((value, ctx) => {
  if (new Set(value.issues).size !== value.issues.length) ctx.addIssue({ code: 'custom', message: '来源问题不得重复' });
  if ((value.stage === 'begin') !== (value.finalStore === null)) ctx.addIssue({ code: 'custom', message: '来源阶段必须保留相应的最终存储状态' });
  if (value.stage === 'begin' && value.continuity !== 'unverified') ctx.addIssue({ code: 'custom', message: '开始元数据不证明最终连续性' });
  if (value.scope === 'execution-local' && (value.plannedPathDigest === null || (value.stage === 'begin' ? value.beginStore : value.finalStore)?.state !== 'observed')) ctx.addIssue({ code: 'custom', message: '本执行来源必须有已观测文件身份' });
  if (value.continuity === 'same' && !sameDevelopmentNativeStore(value.beginStore, value.finalStore)) ctx.addIssue({ code: 'custom', message: '同库连续性必须有相同的实际身份' });
  if (value.continuity === 'new' && (value.beginStore.state !== 'pending' || value.finalStore?.state !== 'observed')) ctx.addIssue({ code: 'custom', message: '新库必须由尚未创建到已观测' });
});
export type DevelopmentNativeStore = z.infer<typeof DevelopmentNativeStoreSchema>;
export type DevelopmentNativeSource = z.infer<typeof DevelopmentNativeSourceSchema>;
export type DevelopmentNativeSourceIssue = z.infer<typeof DevelopmentNativeSourceIssueSchema>;
export function sameDevelopmentNativeStore(before: DevelopmentNativeStore, after: DevelopmentNativeStore | null): boolean {
  return before.state === 'observed' && after?.state === 'observed' && before.sourceEpoch === after.sourceEpoch && before.actualPathDigest === after.actualPathDigest && before.fileIdentityDigest === after.fileIdentityDigest;
}
/** The shared business/ordinary event schema deliberately continues to reject this extension. */
export const DevelopmentRunnerUsageCaptureSchema = RunnerUsageCaptureSchema.extend({ nativeSource: DevelopmentNativeSourceSchema.optional() }).superRefine((value, ctx) => {
  const source = value.nativeSource, proof = value.nativeProof;
  if (!source) return;
  if (!proof || value.measurements.length || value.nativeBaseline || source.lineageKey !== proof.lineageKey || source.turn !== proof.turn || source.turnIndex !== proof.turnIndex || source.observedAt !== proof.observedAt) {
    ctx.addIssue({ code: 'custom', message: '来源元数据只能绑定同一轮的单独证明帧' }); return;
  }
  if ((source.stage === 'begin' && !['pending', 'unsupported'].includes(proof.state)) || (source.stage === 'finish' && proof.state === 'pending')) ctx.addIssue({ code: 'custom', message: '来源阶段和原生证明阶段不符' });
  if (source.continuity === 'new' && proof.baseline.kind !== 'fresh') ctx.addIssue({ code: 'custom', message: '恢复时尚未创建的库不能宣告新库连续性' });
  if (proof.state === 'complete' && (source.stage !== 'finish' || source.finalStore?.state !== 'observed' || !['new', 'same'].includes(source.continuity) || source.issues.length || (proof.baseline.kind === 'resume' && !sameDevelopmentNativeStore(source.beginStore, source.finalStore)))) ctx.addIssue({ code: 'custom', message: '完整来源必须有最终文件身份与可证明的连续性' });
});
export type DevelopmentRunnerUsageCapture = z.infer<typeof DevelopmentRunnerUsageCaptureSchema>;
