import { jsonHash, newResourceId } from '@crewstation/kernel';
import type { ProjectId, ServiceId } from '@crewstation/contracts';
import type { ScmWriteHistory } from '../ports/repositoryWrites';
import type { ScmCurrentRepositoryOriginsSource } from '../ports/currentRepositoryOrigins';

/** Controlled metadata; no native GitLab/filesystem acceptance is claimed. */
export function currentOriginsMaterial(history: ScmWriteHistory): Awaited<ReturnType<ScmCurrentRepositoryOriginsSource['read']>> {
  const before = { id: 'controlled-original-native-instance', startedAt: '2026-09-01T00:00:00.000Z', image: 'controlled-original-native-image', epoch: jsonHash('controlled original native epoch') };
  return { version: 'gitlab-native/19.2.4/v1', before, after: { ...before }, repositories: history.origins.map((origin) => {
    const credentials = history.credentials.filter((value) => value.serviceId === origin.serviceId);
    const effects = history.records.flatMap((value) => value.effects.filter((effect) => effect.stage === 'returned' && effect.kind === 'credential'));
    const tokens = credentials.map((value, index) => {
      const effect = effects.find((row) => row.remoteTokenId === value.remoteTokenId);
      return { id: value.remoteTokenId, name: 'cs-session-' + value.id, userId: effect?.userId ?? String(501 + index),
        createdAt: effect?.createdAt ?? '2026-09-11T00:01:00.000Z', expiresAt: null, revoked: false, scopes: ['read_repository'] };
    });
    const users = [...new Set(tokens.map((value) => value.userId))];
    return { remoteProjectId: origin.remoteProjectId, pathWithNamespace: origin.pathWithNamespace, createdAt: origin.createdAt ?? '2026-09-11T00:00:00.000Z',
      apiTokens: tokens.map((value) => ({ ...value })), nativeTokens: tokens.map((value) => ({ ...value })), relatedTokens: tokens.map((value) => ({ ...value })),
      users: users.map((id) => ({ id, userType: 'project_bot' as const, createdAt: '2026-09-11T00:00:20.000Z', state: 'active' })),
      memberships: users.map((userId, index) => ({ id: String(701 + index), userId, type: 'ProjectMember' as const, sourceType: 'Project' as const, sourceId: origin.remoteProjectId, createdAt: '2026-09-11T00:00:30.000Z' })),
    };
  }) };
}
export function currentOriginsHistory() {
  const projectId = newResourceId() as ProjectId, serviceId = newResourceId() as ServiceId, credentialId = newResourceId();
  const history: ScmWriteHistory = { revision: jsonHash('controlled original history'), metadataComplete: true, metadataCount: 4,
    bindings: [{ serviceId, remoteProjectId: '100', pathWithNamespace: 'crewstation/legacy-origin', bindingCreatedAt: '2026-09-11T00:00:00.000Z' }],
    credentials: [{ id: credentialId, serviceId, remoteTokenId: '1001' }],
    origins: [{ serviceId, remoteProjectId: '100', pathWithNamespace: 'crewstation/legacy-origin', createdAt: null, source: 'legacy-binding' }], records: [],
    identities: [{ kind: 'service', id: serviceId, serviceId }, { kind: 'credential', id: credentialId, serviceId }], unresolvedEffects: [], unownedCredentialIds: [], foreignRepositoryReferences: [] };
  return { projectId, serviceId, credentialId, history };
}
