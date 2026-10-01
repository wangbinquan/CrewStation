import { z } from 'zod';
import { precondition } from '@crewstation/kernel';
import { developmentCleanupSelection } from './cleanupSelection';
import { requireDevelopmentCleanupEvidence } from './cleanupEvidence';
import { developmentWorkloadProtection } from './protection';
import type { TaskEnvironment } from '../taskEnvironment';

export const DevelopmentRemovalSealSchema = z.strictObject({ version: z.literal(1),
  originalRunnerTokenHash: z.string().regex(/^[a-f0-9]{64}$/), selectionHash: z.string().regex(/^[a-f0-9]{64}$/) });
export type DevelopmentRemovalSeal = z.infer<typeof DevelopmentRemovalSealSchema>;

/** A terminal token rotation must never turn an explicitly protected original into legacy. */
export function requireDevelopmentRemovalEvidence(env: TaskEnvironment) {
  if (env.render?.developmentRemovalProtection === undefined) throw precondition('原通用移除选择缺失');
  developmentWorkloadProtection(env);
  let original = env, seal: DevelopmentRemovalSeal | undefined;
  if (env.native?.state === 'finished') {
    if (!['released', 'failed'].includes(env.state)) throw precondition('原开发终态不完整');
    seal = DevelopmentRemovalSealSchema.parse(env.native.developmentRemovalSeal);
    original = { ...env, state: 'releasing', runnerTokenHash: seal.originalRunnerTokenHash, native: { ...env.native, state: 'cleaning' } };
  }
  const selection = developmentCleanupSelection(original);
  if (!selection) throw precondition('原开发数字移除出口尚未受理');
  const evidence = requireDevelopmentCleanupEvidence(original.native!.developmentCleanup, selection);
  if (seal && (seal.selectionHash !== selection.selectionHash || seal.selectionHash !== evidence.selection.selectionHash)) throw precondition('原开发终态受理摘要已冲突');
  return { original, selection, evidence };
}

/** Called only in the existing final, job-fenced Task transaction, before token rotation. */
export function createDevelopmentRemovalSeal(env: TaskEnvironment): DevelopmentRemovalSeal {
  const { selection } = requireDevelopmentRemovalEvidence(env);
  return DevelopmentRemovalSealSchema.parse({ version: 1, originalRunnerTokenHash: env.runnerTokenHash, selectionHash: selection.selectionHash });
}
