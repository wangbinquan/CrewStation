import type {
  Actor, AgentProtocol, ComputeProfileContent, ComputeProfileDetailDto, CopyComputeProfileRequest, CreateComputeProfileRequest, ProfileCredentialWrite, ProfileTestId,
  SaveComputeProfileRequest, UserId,
} from '@crewstation/contracts';
import { conflict, newId, newResourceId, notFound, validation } from '@crewstation/kernel';
import type { ComputeProfile, ProfileCredential, ProfileRevision } from '../domain/computeProfile';
import { contentHashOf, credentialStampOf } from '../domain/computeProfile';
import { planCredentialWrites } from '../domain/credentialWrites';
import { parseProfileImage, pullReference } from '../domain/imageReference';
import type { ProfileTest } from '../domain/profileTest';
import { initialStages } from '../domain/profileTest';
import { validateProfileContent } from '../domain/profileValidation';
import type { RepositoryScope } from '../ports/unitOfWork';
import type { AgentRuntimeUseCaseDeps } from './dependencies';
import { profileQueries } from './profileQueries';
import { adminOnly } from './toDto';
import { copyProfileContent } from './copyProfileContent';

interface PreparedContent {
  content: ComputeProfileContent;
  imageDigest: string;
  /** 这次写入之后的全部凭据（未提到的保留、替换的换新密文、清除的去掉）。 */
  credentials: Pick<ProfileCredential, 'id' | 'name' | 'cipherText'>[];
  replaced: Array<{ id: string; name: string; cipherText: string | null }>;
  cleared: string[];
}

/** 新测试：保存触发或管理员手动；阶段表先按协议与步骤排好。 */
export function queuedTest(revision: ProfileRevision, protocol: AgentProtocol, trigger: ProfileTest['trigger'], createdBy: UserId, now: Date, clientRequestId?: string): ProfileTest {
  return {
    testId: newId('pft') as ProfileTestId, profile: revision.profile, revision: revision.revision, contentHash: revision.contentHash, trigger, createdBy, state: 'queued',
    context: { kind: 'platform-namespace' }, stages: initialStages(protocol, revision.content.steps), createdAt: now, ...(clientRequestId ? { clientRequestId } : {}),
  };
}

/** 写入：校验内容、解析镜像摘要、规划凭据；都在事务外做完，事务里只落库。 */
async function prepare(deps: AgentRuntimeUseCaseDeps, protocol: AgentProtocol, content: ComputeProfileContent, writes: Record<string, ProfileCredentialWrite>, existing: readonly ProfileCredential[]): Promise<PreparedContent> {
  validateProfileContent(protocol, content);
  if (content.taskProfile && !(await deps.taskProfiles.exists(content.taskProfile))) throw notFound('资源套餐', content.taskProfile);
  const parsed = parseProfileImage(content.image, deps.registry.layout);
  if (!parsed.ok) throw validation(parsed.reason, { field: 'content.image' });
  const imageDigest = await deps.registry.resolveDigest(parsed.image.repository, parsed.image);
  const plan = planCredentialWrites(new Set(existing.filter((credential) => credential.cipherText !== null).map((c) => c.id)), content.secrets, writes);
  const replaced = await Promise.all(plan.replace.map(async ({ id, value }) => ({ id, name: content.secrets.find((entry) => entry.id === id)!.name, cipherText: await deps.cipher.encrypt(value) })));
  const credentials = [
    ...existing.filter((c) => !plan.clear.includes(c.id) && !replaced.some((r) => r.id === c.id)).map(({ id, name, cipherText }) => ({ id, name: content.secrets.find((entry) => entry.id === id)?.name ?? name, cipherText })),
    ...replaced,
    ...content.secrets.filter((entry) => !existing.some((credential) => credential.id === entry.id) && !replaced.some((credential) => credential.id === entry.id)).map((entry) => ({ ...entry, cipherText: null })),
  ];
  return { content: { ...content, image: pullReference(parsed.image, deps.registry.layout) }, imageDigest, credentials, replaced: credentials.filter((credential) => !existing.some((prior) => prior.id === credential.id && prior.name === credential.name && prior.cipherText === credential.cipherText)), cleared: plan.clear };
}

async function applyCredentials(scope: RepositoryScope, profile: string, prepared: Pick<PreparedContent, 'replaced' | 'cleared'>, actor: UserId, now: Date): Promise<void> {
  for (const credential of prepared.replaced) await scope.credentials.upsert({ id: credential.id, profile, name: credential.name, cipherText: credential.cipherText, updatedBy: actor, updatedAt: now });
  for (const name of prepared.cleared) await scope.credentials.remove(profile, name, actor, now);
}

/** 建档与复制共用：档位、修订 1、凭据与一次保存触发的测试在同一事务里落库。 */
async function insertProfile(deps: AgentRuntimeUseCaseDeps, actor: Actor, input: { name: string; description: string; protocol: AgentProtocol; defaultVisible?: boolean }, prepared: PreparedContent): Promise<string> {
  const now = deps.clock.now();
  const hash = contentHashOf(prepared.content, prepared.imageDigest, credentialStampOf(prepared.content.secrets, prepared.credentials));
  const profile: ComputeProfile = { id: newResourceId(), name: input.name, protocol: input.protocol, description: input.description, enabled: true, isDefault: false, defaultVisible: input.defaultVisible ?? true, currentRevision: 1, createdBy: actor.userId, createdAt: now, updatedBy: actor.userId, updatedAt: now };
  const revision: ProfileRevision = { profile: profile.id, revision: 1, content: prepared.content, imageDigest: prepared.imageDigest, contentHash: hash, createdBy: actor.userId, createdAt: now };
  const test = queuedTest(revision, input.protocol, 'save', actor.userId, now);
  await deps.uow.run(async (scope) => {
    await scope.profiles.insert(profile);
    await scope.revisions.insert(revision);
    for (const credential of prepared.credentials) await scope.credentials.upsert({ id: credential.id, profile: profile.id, name: credential.name, cipherText: credential.cipherText, updatedBy: actor.userId, updatedAt: now });
    await scope.tests.insert(test);
    await scope.testQueue.enqueue(test.testId);
  });
  return profile.id;
}

/**
 * 保存即生效（C7）：执行相关内容（含镜像摘要与凭据）变化才追加新修订并自动测试（C9）；只改说明不产生修订（P3）。
 * expectedRevision 比较失败报 409，表单留在客户端。
 */
export function profileWriteUseCases(deps: AgentRuntimeUseCaseDeps) {
  const { uow, clock } = deps;
  const { getProfile } = profileQueries(deps);
  const save = async (actor: Actor, name: string, input: SaveComputeProfileRequest): Promise<ComputeProfileDetailDto> => {
    adminOnly(actor);
    const existing = await uow.read.profiles.get(name);
    if (!existing) throw notFound('算力档位', name);
    const prepared = await prepare(deps, existing.protocol, input.content, input.credentials, await uow.read.credentials.list(name));
    const now = clock.now();
    await uow.run(async (scope) => {
      const profile = await scope.profiles.lock(name);
      if (!profile) throw notFound('算力档位', name);
      if (profile.currentRevision !== input.expectedRevision) throw conflict(`档位 ${name} 已被修改（当前修订 ${profile.currentRevision}），你的修改已保留，请对照后再保存`, { code: 'profile_revision_conflict', currentRevision: profile.currentRevision });
      const current = await scope.revisions.get(name, profile.currentRevision);
      const hash = contentHashOf(prepared.content, prepared.imageDigest, credentialStampOf(prepared.content.secrets, prepared.credentials));
      const description = input.description ?? profile.description, displayName = input.name ?? profile.name;
      if (current?.contentHash === hash) {
        // 内容与凭据戳都没变：只可能清掉了已取消声明的旧凭据，照做但不产生修订、不重测。
        await applyCredentials(scope, name, prepared, actor.userId, now);
        if (description !== profile.description || displayName !== profile.name) await scope.profiles.update({ ...profile, name: displayName, description, updatedBy: actor.userId, updatedAt: now });
        return;
      }
      const revision: ProfileRevision = { profile: name, revision: profile.currentRevision + 1, content: prepared.content, imageDigest: prepared.imageDigest, contentHash: hash, createdBy: actor.userId, createdAt: now };
      await applyCredentials(scope, name, prepared, actor.userId, now);
      await scope.revisions.insert(revision);
      await scope.tests.supersedeBefore(name, revision.revision, now);
      const test = queuedTest(revision, profile.protocol, 'save', actor.userId, now);
      await scope.tests.insert(test);
      await scope.testQueue.enqueue(test.testId);
      await scope.profiles.update({ ...profile, name: displayName, description, currentRevision: revision.revision, updatedBy: actor.userId, updatedAt: now });
    });
    return getProfile(actor, name);
  };
  return {
    createProfile: async (actor: Actor, input: CreateComputeProfileRequest): Promise<ComputeProfileDetailDto> => {
      adminOnly(actor);
      const protocol = input.content.launch.protocol;
      const id = await insertProfile(deps, actor, { name: input.name, description: input.description, protocol, defaultVisible: input.defaultVisible }, await prepare(deps, protocol, input.content, input.credentials, []));
      return getProfile(actor, id);
    },
    saveProfile: save,
    /** 复制（P5）：同样的内容与凭据密文，新名字，镜像摘要重新解析；自动测试独立进行。 */
    copyProfile: async (actor: Actor, source: string, input: CopyComputeProfileRequest): Promise<ComputeProfileDetailDto> => {
      adminOnly(actor);
      const from = await uow.read.profiles.get(source);
      if (!from) throw notFound('算力档位', source);
      const revision = await uow.read.revisions.get(source, from.currentRevision);
      if (!revision) throw notFound('档位修订', `${source}@${from.currentRevision}`);
      const copied = copyProfileContent(revision.content, await uow.read.credentials.list(source));
      const id = await insertProfile(deps, actor, { name: input.name, description: input.description ?? from.description, protocol: from.protocol, defaultVisible: from.defaultVisible }, await prepare(deps, from.protocol, copied.content, {}, copied.credentials));
      return getProfile(actor, id);
    },
  };
}
