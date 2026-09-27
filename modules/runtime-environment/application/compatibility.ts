import type { Actor, RuntimeImageValidationTarget } from '@crewstation/contracts';
import { RuntimeImageDigestSchema, RuntimeImageValidationTargetSchema } from '@crewstation/contracts';
import { notFound, precondition } from '@crewstation/kernel';
import { imageContentDigest } from '../domain/contentDigest';
import type { ImageRevision, ImageVersion } from '../domain/records';
import type { RepositoryScope } from '../ports/unitOfWork';
import type { RuntimeImageDeps } from './dependencies';
import { checkedSecretVersions } from './initializationSecrets';
import { imageAccess } from './access';

export async function versionAccess(deps: RuntimeImageDeps, actor: Actor, projectId: string | undefined, versionId: string, scope: RepositoryScope = deps.uow.read): Promise<{ version: ImageVersion; revision: ImageRevision }> {
  const version = await scope.versions.get(versionId);
  if (!version) throw notFound('运行镜像版本', versionId);
  await imageAccess(deps, actor, projectId, version.imageId, 'view', scope);
  const revision = await scope.revisions.get(version.revisionId);
  if (!revision) throw notFound('运行镜像修订', version.revisionId);
  return { version, revision };
}
export async function compatibilityEvidence(deps: RuntimeImageDeps, actor: Actor, projectId: string, version: ImageVersion, revision: ImageRevision, target: RuntimeImageValidationTarget) {
  const parsed = RuntimeImageValidationTargetSchema.parse(target);
  // 公共镜像不能借所属项目的运行 Secret 向其他项目注入凭据。
  if (revision.initializerProjectId && revision.initializerProjectId !== projectId && revision.initializer.secrets.length) throw precondition('包含项目初始化 Secret 的镜像不能跨项目使用');
  if (revision.initializer.secrets.length && !deps.validationContracts.secretVersions) throw precondition('初始化凭据版本端口尚未配置');
  const initializerSecretVersions = checkedSecretVersions(revision.initializer, revision.initializer.secrets.length ? await deps.validationContracts.secretVersions!(actor, projectId, revision) : []);
  const platform = RuntimeImageDigestSchema.parse(await deps.validationContracts.fingerprint(actor, projectId, version, revision, parsed));
  const contractDigest = imageContentDigest({ platform, projectId, initializerSecretVersions, image: `${version.repository}@${version.digest}`, architecture: version.architecture, initializerDigest: version.initializerDigest, toolsDigest: version.toolsDigest, target: parsed });
  return { contractDigest, initializerSecretVersions };
}
export const versionLock = (version: ImageVersion): string => `digest:${version.repository}@${version.digest}`;

export async function requireAvailable(deps: RuntimeImageDeps, actor: Actor, projectId: string, versionId: string, scope: RepositoryScope) {
  // 与撤销授权串行化：授权先完成则本次拒绝，准入先完成则保留已经接受的固定快照。
  await scope.lock(`image-policy:${projectId}`);
  const data = await versionAccess(deps, actor, projectId, versionId, scope);
  // 默认开放范围与停用状态也可能并发变化；取得定义行锁后重新验证可见性。
  const image = await imageAccess(deps, actor, projectId, data.version.imageId, 'view', scope, true);
  if (!image?.enabled || data.version.state !== 'available') throw precondition('运行镜像已停用或正在回收，不能新采用', { code: 'image_unavailable', imageVersionId: versionId });
  return data;
}
