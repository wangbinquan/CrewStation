import type { Actor, RuntimeCheckDto, RuntimeConfigDto, RuntimeConfigRevisionDto, RuntimeCredentialState } from '@crewstation/contracts';
import { forbidden } from '@crewstation/kernel';
import type { RuntimeCheck } from '../domain/runtimeCheck';
import type { RuntimeConfig, RuntimeCredential, RuntimeRevision } from '../domain/runtimeConfig';
import { statusOf } from '../domain/runtimeConfig';

export function adminOnly(actor: Actor): void {
  if (!actor.isAdmin) throw forbidden('只有管理员可以维护 Agent 运行环境');
}

export function configToDto(config: RuntimeConfig, referencedProfiles: number, latestDraftCheck: RuntimeCheck | undefined): RuntimeConfigDto {
  return {
    id: config.id, name: config.name, description: config.description, driver: config.driver, status: statusOf(config, latestDraftCheck),
    draftRevision: config.draftRevision, activeRevision: config.activeRevision, enabled: config.enabled, referencedProfiles,
    updatedBy: config.updatedBy, updatedAt: config.updatedAt.toISOString(),
  };
}

export function revisionToDto(revision: RuntimeRevision): RuntimeConfigRevisionDto {
  return {
    revision: revision.revision, steps: revision.steps, vars: revision.vars, secretNames: revision.secretNames, configFile: revision.configFile,
    ...(revision.defaultModel ? { defaultModel: revision.defaultModel } : {}), models: revision.models, contentHash: revision.contentHash,
    createdBy: revision.createdBy, createdAt: revision.createdAt.toISOString(),
  };
}

/** 声明的每个凭据名只报告有没有值；密文与原值都不出模块。 */
export function credentialStates(declared: readonly string[], stored: readonly RuntimeCredential[]): RuntimeCredentialState[] {
  return declared.map((name) => {
    const found = stored.find((c) => c.name === name);
    return found ? { name, set: true, updatedBy: found.updatedBy, updatedAt: found.updatedAt.toISOString() } : { name, set: false };
  });
}

export function checkToDto(check: RuntimeCheck): RuntimeCheckDto {
  return {
    checkId: check.checkId, configId: check.configId, revision: check.revision, contentHash: check.contentHash, clientRequestId: check.clientRequestId,
    ...(check.model ? { model: check.model } : {}), state: check.state, context: check.context, stages: check.stages, ...(check.error ? { error: check.error } : {}),
    createdBy: check.createdBy, createdAt: check.createdAt.toISOString(), ...(check.startedAt ? { startedAt: check.startedAt.toISOString() } : {}), ...(check.endedAt ? { endedAt: check.endedAt.toISOString() } : {}),
  };
}
