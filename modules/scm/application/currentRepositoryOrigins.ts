import { ProjectIdSchema } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import { z } from 'zod';
import type { ProjectId } from '@crewstation/contracts';
import type { ScmWriteHistory } from '../ports/repositoryWrites';
import type { ScmCurrentNativeRepository, ScmCurrentRepositoryOriginsSource, ScmCurrentRepositoryOriginsWitness } from '../ports/currentRepositoryOrigins';

const hash = z.string().regex(/^[a-f0-9]{64}$/), id = z.string().regex(/^[1-9][0-9]*$/).refine((value) => Number.isSafeInteger(Number(value)));
const time = z.iso.datetime({ offset: true }), path = z.string().min(1).max(512).regex(/^[^\x00-\x20\x7f]+$/);
const instance = z.object({ id: z.string().min(1).max(512), startedAt: time, image: z.string().min(1).max(512), epoch: hash }).strict();
const token = z.object({ id, name: z.string().min(1).max(512), userId: id, createdAt: time,
  expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), revoked: z.boolean(), scopes: z.array(z.string().min(1)) }).strict();
const original = z.object({ remoteProjectId: id, pathWithNamespace: path, createdAt: time }).strict();
const repository = original.extend({ apiTokens: z.array(token), nativeTokens: z.array(token), relatedTokens: z.array(token),
  users: z.array(z.object({ id, userType: z.literal('project_bot'), createdAt: time, state: z.string().min(1) }).strict()),
  memberships: z.array(z.object({ id, userId: id, type: z.literal('ProjectMember'), sourceType: z.literal('Project'), sourceId: id, createdAt: time }).strict()),
}).strict();
const material = z.object({ version: z.literal('gitlab-native/19.2.4/v1'), before: instance, after: instance, repositories: z.array(repository) }).strict();
export const ScmCurrentRepositoryOriginsWitnessSchema = z.object({ version: z.literal(1), projectId: ProjectIdSchema, historyRevision: hash,
  source: z.object({ identity: hash, epoch: hash, version: z.literal('gitlab-native/19.2.4/v1') }).strict(),
  repositories: z.array(original.extend({ identity: hash })),
  credentials: z.array(z.object({ platformCredentialId: z.uuid().nullable(), remoteProjectId: id, remoteTokenId: id,
    createdAt: time, userId: id, userCreatedAt: time, membershipId: id, membershipCreatedAt: time,
    historicalCreatedAt: time.nullable(), historicalUserId: id.nullable() }).strict()),
  historicalCallbacksReconstructed: z.literal(false), digest: hash,
}).strict().refine(({ digest, ...facts }) => digest === jsonHash(facts), 'Current-origin witness digest changed');
const reject = (message: string): never => { throw precondition(message); };
const unique = (values: readonly string[]) => new Set(values).size === values.length;
const ordered = <T>(values: readonly T[]) => [...values].sort((a, b) => jsonHash(a).localeCompare(jsonHash(b)));
const tokenFacts = (value: ScmCurrentNativeRepository['nativeTokens'][number]) => ({ ...value, scopes: [...value.scopes].sort() });

function validateNative(row: ScmCurrentNativeRepository) {
  for (const values of [row.apiTokens, row.nativeTokens, row.relatedTokens, row.users, row.memberships]) {
    if (!unique(values.map((value) => value.id))) reject('当前代码仓库来源存在重复身份');
  }
  const facts = (values: typeof row.nativeTokens) => ordered(values.map(tokenFacts));
  if (jsonHash(facts(row.apiTokens)) !== jsonHash(facts(row.nativeTokens)) || jsonHash(facts(row.relatedTokens)) !== jsonHash(facts(row.nativeTokens))) reject('当前 API／原数据库令牌枚举不一致或存在额外个人令牌');
  const users = [...new Set(row.nativeTokens.map((value) => value.userId))].sort();
  if (jsonHash(users) !== jsonHash(row.users.map((value) => value.id).sort()) || row.memberships.length !== users.length
    || !unique(row.memberships.map((value) => value.userId)) || row.memberships.some((value) => !users.includes(value.userId) || value.sourceId !== row.remoteProjectId)) reject('当前机器人归属缺失或共享其他项目／组');
}

export function scmCurrentRepositoryOrigins(projectId: ProjectId, history: ScmWriteHistory,
  raw: Awaited<ReturnType<ScmCurrentRepositoryOriginsSource['read']>>): ScmCurrentRepositoryOriginsWitness {
  const snapshot = material.parse(raw);
  if (jsonHash(snapshot.before) !== jsonHash(snapshot.after)) reject('当前代码仓库原实例在读取期间变化');
  if (!history.metadataComplete || history.unownedCredentialIds.length || history.foreignRepositoryReferences.length || history.unresolvedEffects.length) reject('代码仓库历史仍有未知归属、外部引用或未闭合副作用');
  if (history.credentials.some((value) => !history.identities.some((entry) => entry.kind === 'credential' && entry.id === value.id && entry.serviceId === value.serviceId)
    || !history.identities.some((entry) => entry.kind === 'service' && entry.id === value.serviceId))) reject('旧凭据没有完整平台最小归属身份');
  const parents = history.origins.map((value) => value.remoteProjectId);
  if (!unique(parents) || !unique(snapshot.repositories.map((value) => value.remoteProjectId))
    || jsonHash([...parents].sort()) !== jsonHash(snapshot.repositories.map((value) => value.remoteProjectId).sort())) reject('当前来源遗漏、重复或扩展原远端仓库');
  if (history.bindings.some((binding) => !history.origins.some((origin) => origin.serviceId === binding.serviceId && origin.remoteProjectId === binding.remoteProjectId && origin.pathWithNamespace === binding.pathWithNamespace))
    || history.records.some((work) => work.remoteProjectId !== null && !parents.includes(work.remoteProjectId))) reject('原绑定或回调缺少完整当前仓库来源');
  const source = { identity: jsonHash({ id: snapshot.before.id, startedAt: snapshot.before.startedAt, image: snapshot.before.image }), epoch: snapshot.before.epoch, version: snapshot.version };
  const repositories = snapshot.repositories.map((row) => {
    const known = history.origins.find((value) => value.remoteProjectId === row.remoteProjectId)!;
    if (row.pathWithNamespace !== known.pathWithNamespace || known.createdAt !== null && row.createdAt !== known.createdAt) reject('当前原仓库路径或已知创建身份冲突');
    validateNative(row);
    const fields = { remoteProjectId: row.remoteProjectId, pathWithNamespace: row.pathWithNamespace, createdAt: row.createdAt };
    return { ...fields, identity: jsonHash({ source: source.identity, ...fields }) };
  });
  const effects = history.records.flatMap((value) => value.effects.filter((effect) => effect.stage === 'returned' && effect.kind === 'credential'));
  for (const effect of effects) {
    const native = snapshot.repositories.find((row) => row.remoteProjectId === effect.remoteProjectId)?.nativeTokens.find((value) => value.id === effect.remoteTokenId);
    if (!native || effect.createdAt && effect.createdAt !== native.createdAt || effect.userId && effect.userId !== native.userId) reject('当前来源与已知原回调身份冲突');
  }
  const credentials = snapshot.repositories.flatMap((row) => row.nativeTokens.map((native) => {
    const known = history.credentials.filter((value) => value.remoteTokenId === native.id && history.origins.some((origin) => origin.serviceId === value.serviceId && origin.remoteProjectId === row.remoteProjectId));
    if (known.length > 1) reject('当前令牌存在多个平台归属');
    const binding = known[0], effect = effects.find((value) => value.remoteProjectId === row.remoteProjectId && value.remoteTokenId === native.id);
    if (binding && !['cs-session-' + binding.id, 'cs-build-' + binding.id].includes(native.name)) reject('当前旧凭据缺少精确原 ID／名称关联');
    if (effect && (effect.createdAt && effect.createdAt !== native.createdAt || effect.userId && effect.userId !== native.userId || binding && effect.credentialId !== binding.id)) reject('当前令牌身份与已知原回调结果冲突');
    const user = row.users.find((value) => value.id === native.userId)!, member = row.memberships.find((value) => value.userId === native.userId)!;
    return { platformCredentialId: binding?.id ?? effect?.credentialId ?? null, remoteProjectId: row.remoteProjectId, remoteTokenId: native.id, createdAt: native.createdAt,
      userId: native.userId, userCreatedAt: user.createdAt, membershipId: member.id, membershipCreatedAt: member.createdAt,
      historicalCreatedAt: effect?.createdAt ?? null, historicalUserId: effect?.userId ?? null };
  }));
  if (!unique(history.credentials.map((value) => value.id)) || !unique(history.credentials.map((value) => value.remoteTokenId))
    || history.credentials.some((value) => !credentials.some((current) => current.platformCredentialId === value.id))
    || effects.some((effect) => !credentials.some((current) => current.remoteProjectId === effect.remoteProjectId && current.remoteTokenId === effect.remoteTokenId))) reject('当前来源没有覆盖原平台凭据或已返回原令牌');
  const facts = { version: 1 as const, projectId, historyRevision: history.revision, source, repositories: ordered(repositories), credentials: ordered(credentials), historicalCallbacksReconstructed: false as const };
  return ScmCurrentRepositoryOriginsWitnessSchema.parse({ ...facts, digest: jsonHash(facts) });
}
