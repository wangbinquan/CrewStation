import { z } from 'zod';
import { FullCommitShaSchema, ReleaseIdSchema, ResourceIdSchema, TaskIdSchema } from '@crewstation/contracts';

export const PublishIntentSchema = z.object({
  tag: z.string().regex(/^v\d+\.\d+\.\d+$/), branch: z.string().min(1).max(256), commitSha: FullCommitShaSchema,
  source: z.enum(['repository', 'session']), taskId: TaskIdSchema.optional(), actorId: z.string().min(1).max(128), message: z.string().max(500),
}).strict();
export const WizardDraftSchema = z.object({
  version: z.literal(1), source: z.enum(['repository', 'session']), branch: z.string().max(256), tag: z.string().max(80), message: z.string().max(500),
  intent: PublishIntentSchema.optional(),
}).strict();
export const LaunchIntentSchema = z.object({
  requestKey: z.string().min(1).max(128), journeyId: ResourceIdSchema, toSlot: z.literal('preview'),
  expectedActiveRelease: ReleaseIdSchema.nullable(), expectedTargetRelease: ReleaseIdSchema,
  expectedTargetRevision: z.string().regex(/^[a-f0-9]{64}$/), reason: z.string().max(500).optional(),
}).strict();
export type WizardDraft = z.infer<typeof WizardDraftSchema>;
export type PublishIntent = z.infer<typeof PublishIntentSchema>;
export type LaunchIntent = z.infer<typeof LaunchIntentSchema>;
export const wizardStorageKey = (userId: string, space: string, projectId: string, id: string) => `cs.release-wizard.v1:${[userId, space, projectId, id].map(encodeURIComponent).join(':')}`;
export function readWizardStorage<T>(key: string, schema: z.ZodType<T>): T | undefined {
  try { const text = sessionStorage.getItem(key); return text && text.length <= 8192 ? schema.safeParse(JSON.parse(text)).data : undefined; } catch { return undefined; }
}
export function saveWizardStorage(key: string, value: unknown): boolean {
  try { const text = JSON.stringify(value); if (text.length > 8192) return false; sessionStorage.setItem(key, text); return true; } catch { return false; }
}
export function removeWizardStorage(key: string): void { try { sessionStorage.removeItem(key); } catch { /* Draft remains isolated to this browser tab. */ } }
