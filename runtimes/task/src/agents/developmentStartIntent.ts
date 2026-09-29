import { createHash } from 'node:crypto';
import type { DevelopmentUsageAdmission, StartAgentCommand } from '@crewstation/contracts';
import { DevelopmentStartIntentSchema, DevelopmentUsageAdmissionSchema } from '@crewstation/contracts';
import { RunnerCommandError } from '../commandError';

/** Zod's explicit shape supplies a stable order and normalized launch defaults. Never hash transport credentials. */
export function developmentIntentDigest(admission: Pick<DevelopmentUsageAdmission, 'intent' | 'digestNonce'>): string {
  const intent = DevelopmentStartIntentSchema.parse(admission.intent);
  return createHash('sha256').update(admission.digestNonce).update('\n').update(JSON.stringify(intent)).digest('hex');
}
export function validateDevelopmentStart(command: StartAgentCommand, raw: DevelopmentUsageAdmission): DevelopmentUsageAdmission {
  const admission = DevelopmentUsageAdmissionSchema.parse(raw);
  const actual = DevelopmentStartIntentSchema.parse({ ...admission.intent,
    identity: { ...admission.intent.identity, agentId: command.agentId },
    profileRevision: command.profileRevision, launch: command.launch, permission: command.permission, mode: command.mode,
    initialPrompt: command.initialPrompt ?? null, cwd: command.cwd ?? null, resumeSessionId: command.resumeSessionId ?? null,
    systemPrompt: command.systemPrompt ?? null, mcp: command.mcp.map(({ name, url }) => ({ name, url })),
  });
  if (command.beforeStart.profile !== admission.intent.profileId || command.beforeStart.revision !== admission.intent.profileRevision || JSON.stringify(actual) !== JSON.stringify(admission.intent) || developmentIntentDigest(admission) !== admission.key.payloadDigest) throw new RunnerCommandError('development_intent_conflict', '开发启动命令不符合受理时固定的意图');
  return admission;
}
