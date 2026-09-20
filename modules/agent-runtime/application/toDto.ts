import type { Actor, ComputeProfileListItem, ProfileCredentialState, ProfileTestDto } from '@crewstation/contracts';
import { forbidden } from '@crewstation/kernel';
import type { ComputeProfile, ProfileCredential, ProfileRevision } from '../domain/computeProfile';
import { availabilityOf } from '../domain/computeProfile';
import type { ProfileTest } from '../domain/profileTest';

export function adminOnly(actor: Actor): void {
  if (!actor.isAdmin) throw forbidden('只有管理员可以维护算力档位');
}

export function testToDto(test: ProfileTest): ProfileTestDto {
  return {
    testId: test.testId, profile: test.profile, revision: test.revision, contentHash: test.contentHash, trigger: test.trigger, state: test.state,
    ...(test.outcome ? { outcome: test.outcome } : {}), stages: test.stages, context: test.context, ...(test.error ? { error: test.error } : {}),
    createdBy: test.createdBy, createdAt: test.createdAt.toISOString(), ...(test.startedAt ? { startedAt: test.startedAt.toISOString() } : {}), ...(test.endedAt ? { endedAt: test.endedAt.toISOString() } : {}),
  };
}

export function listItemOf(profile: ComputeProfile, revision: ProfileRevision, latest: ProfileTest | undefined): ComputeProfileListItem {
  const { launch } = revision.content;
  return {
    name: profile.name, protocol: profile.protocol, description: profile.description, enabled: profile.enabled, isDefault: profile.isDefault, defaultVisible: profile.defaultVisible ?? true, revision: revision.revision,
    image: revision.content.image, imageDigest: revision.imageDigest, binaryPath: launch.binaryPath, ...(launch.model ? { model: launch.model } : {}),
    ...(revision.content.taskProfile ? { taskProfile: revision.content.taskProfile } : {}), availability: availabilityOf(profile, revision, latest),
    ...(latest ? { latestTest: testToDto(latest) } : {}), updatedBy: profile.updatedBy, updatedAt: profile.updatedAt.toISOString(),
  };
}

/** 声明的每个凭据名只报告有没有值；密文与原值都不出模块。 */
export function credentialStates(declared: readonly string[], stored: readonly ProfileCredential[]): ProfileCredentialState[] {
  return declared.map((name) => {
    const found = stored.find((c) => c.name === name);
    return found ? { name, set: true, updatedBy: found.updatedBy, updatedAt: found.updatedAt.toISOString() } : { name, set: false };
  });
}
