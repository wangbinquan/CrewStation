import { expect, test } from 'bun:test';
import { BeforeStartMaterialSchema, RuntimeImageRevisionDtoSchema, RuntimeImageVersionDtoSchema } from '@crewstation/contracts';
import type { Actor, UserId } from '@crewstation/contracts';
import type { RuntimeImagePlatformPorts } from '../ports/runtimeImages';
import { runtimeImagePlatformPorts } from './runtimeImagePorts';

const id = (n: number) => `01a0bf5d-8f4b-7111-8111-${String(n).padStart(12, '0')}`, digest = `sha256:${'a'.repeat(64)}`;
const actor: Actor = { userId: id(1) as UserId, isAdmin: false };
function fixture() {
  const calls: Array<{ key: string; args: unknown[] }> = [];
  const record = (key: string, ...args: unknown[]) => { calls.push({ key, args }); };
  const state = { admin: false, revision: 2, commitSha: 'b'.repeat(40), beforeStart: BeforeStartMaterialSchema.parse({ profile: id(4), revision: 2, contentHash: digest, steps: [], configFile: { kind: 'none' } }) };
  const ports: RuntimeImagePlatformPorts = {
    isAdmin: async () => state.admin,
    project: { authorize: async (...args) => record('authorize', ...args), getProject: async (...args) => { record('project', ...args); return { slug: 'tools', namespace: 'cs-tools' }; } },
    scm: {
      resolveBuildSource: async (...args) => { record('resolve', ...args); return { commitSha: state.commitSha, httpUrl: 'https://git.test/tools.git', tree: [] }; },
      readFile: async (...args) => { record('read', ...args); return 'FROM base'; },
      issueBuildCredential: async (...args) => { record('git', ...args); return { id: id(5), token: 'short-lived-token' }; },
      revokeBuildCredential: async (...args) => record('revoke', ...args),
    },
    compute: {
      resolveForProject: async (...args) => { record('profile', ...args); return { id: id(4), revision: state.revision, image: 'ignored-tag' }; },
      launchMaterial: async () => ({ beforeStart: state.beforeStart, image: `registry.test/runtime/agent@${digest}` }),
      issueBuildPushCredential: async (...args) => { record('push', ...args); return { pushHost: 'external.test', username: id(8), password: 'push-token', expiresAt: '2026-09-28T00:00:00Z', pushPrefixes: [], pullPrefixes: [] }; },
    },
    config: {
      secretDefinitionVersions: async (...args) => { record('versions', ...args); return args[3].map((definitionId) => ({ definitionId, itemId: id(9), version: 3 })); },
      renderPinnedSecretDefinitions: async (...args) => { record('pinned', ...args); return { [id(6)]: 'pinned-value' }; },
      renderSecretDefinitions: async (...args) => { record('packages', ...args); return { [id(6)]: 'package-token' }; },
    },
  };
  const api = runtimeImagePlatformPorts(ports, { systemNamespace: 'cs-system', serviceDomain: 'svc.test', registryBase: 'registry.test', registryPushHost: 'external.test', registryScheme: 'http', baseImage: { repository: 'platform/task', tag: 'v1' }, taskImage: 'task:v1', builderImage: 'builder:v1' });
  const revision = RuntimeImageRevisionDtoSchema.parse({ id: id(10), imageId: id(11), revision: 1, source: { kind: 'source', usage: 'agent', repositoryBindingId: id(3), ref: 'main', architecture: 'linux/arm64', baseProfile: { profileId: id(4), revision: 2 }, secrets: [{ id: 'npm', configDefinitionId: id(6), environment: 'development' }] }, commitSha: state.commitSha, baseImage: `registry.test/platform/task@${digest}`, recipeDigest: digest, initializer: { steps: [], env: {}, secrets: [{ id: 'config', configDefinitionId: id(6), environment: 'production' }] }, tools: [], createdBy: actor.userId, createdAt: '2026-09-27T00:00:00Z' });
  return { api, calls, state, revision, build: { id: id(8), projectId: id(2), createdBy: actor.userId, deadline: new Date(Date.now() + 600000).toISOString() } };
}

test('平台构建只允许管理员选底座，业务验证仍绑定当前授权修订', async () => {
  const f = fixture(), source = f.revision.source;
  if (source.kind !== 'source') throw new Error('fixture requires source recipe');
  await expect(f.api.existingImageAccess(actor, id(2))).rejects.toMatchObject({ kind: 'forbidden' });
  expect((await f.api.existingImageAccess({ ...actor, isAdmin: true }, id(2))).prefixes).toEqual(['runtime']);
  await f.api.authorizer.authorize(actor, id(2), 'manage');
  expect(f.calls.at(-1)?.args[2]).toBe('manage-production-config');
  const admin = { ...actor, isAdmin: true };
  await expect(f.api.bases.resolve(actor, id(2), source)).rejects.toMatchObject({ kind: 'forbidden' });
  expect(await f.api.bases.resolve(admin, undefined, { ...source, usage: 'service' })).toBeUndefined();
  expect(await f.api.bases.resolve(admin, undefined, { ...source, usage: 'task' })).toBe('registry.test/platform/task:v1');
  expect(await f.api.bases.resolve(admin, undefined, source)).toBe(`registry.test/runtime/agent@${digest}`);
  expect(f.calls.filter((c) => c.key === 'profile')).toEqual([]);
  expect(await f.api.validationContracts.profileRevision(actor, id(2), id(4))).toEqual({ profileId: id(4), revision: 2 });
  f.state.revision = 3;
  await expect(f.api.bases.resolve(admin, undefined, { ...source, baseProfile: undefined })).rejects.toThrow('精确算力档位');
});

test('平台构建使用系统命名空间，源码业务只用于材料；提交者撤权后不能签发源码凭据', async () => {
  const f = fixture(), build = { ...f.build, projectId: undefined, sourceProjectId: id(2) };
  f.state.admin = true;
  expect(await f.api.buildContext(build, f.revision)).toEqual({ namespace: 'cs-system', slug: 'platform', repositoryUrl: 'https://git.test/tools.git' });
  expect(f.calls.some((call) => call.key === 'project')).toBe(false);
  expect(f.calls.find((call) => call.key === 'resolve')?.args[1]).toBe(id(2));
  await f.api.credentials.push(build, f.revision);
  expect(f.calls.find((call) => call.key === 'push')?.args[0]).toMatchObject({ projectId: undefined, buildId: build.id });
  f.state.admin = false;
  await expect(f.api.buildContext(build, f.revision)).rejects.toMatchObject({ kind: 'forbidden' });
  await expect(f.api.credentials.issueGit(build, f.revision)).rejects.toMatchObject({ kind: 'forbidden' });
});

test('构建凭据保持源码 SHA 和构建仓库范围，包 Secret 与初始化固定版本按环境分别取值', async () => {
  const f = fixture();
  expect(await f.api.buildContext(f.build, f.revision)).toEqual({ namespace: 'cs-tools', slug: 'tools', repositoryUrl: 'https://git.test/tools.git' });
  expect(f.calls.find((c) => c.key === 'resolve')?.args).toEqual([actor, id(2), id(3), f.revision.commitSha]);
  expect(await f.api.credentials.issueGit(f.build, f.revision)).toMatchObject({ token: 'short-lived-token' });
  expect(f.calls.find((c) => c.key === 'git')?.args[1]).toBe(10);
  await f.api.credentials.revokeGit(f.revision, id(5)); expect(f.calls.at(-1)?.args).toEqual([id(3), id(5)]);
  expect(await f.api.credentials.push(f.build, f.revision)).toEqual({ host: 'registry-push.svc.test', username: id(8), password: 'push-token' });
  expect(f.calls.find((c) => c.key === 'push')?.args[0]).toEqual({ projectId: id(2), buildId: id(8), expiresAt: f.build.deadline, pullRepositories: ['platform/task'] });
  await expect(f.api.credentials.push(f.build, { ...f.revision, baseImage: `foreign.test/private@${digest}` })).rejects.toThrow('底座仓库不合法');
  expect(await f.api.credentials.packages(f.build, f.revision)).toEqual({ npm: 'package-token' });
  const stamps = await f.api.validationContracts.secretVersions(actor, id(2), f.revision);
  expect(stamps).toEqual([{ environment: 'production', definitionId: id(6), itemId: id(9), version: 3 }]);
  expect(await f.api.initializationSecrets.render(id(2), stamps)).toEqual({ [`production:${id(6)}`]: 'pinned-value' });
  expect(f.calls.find((c) => c.key === 'pinned')?.args).toEqual([id(2), 'production', [{ definitionId: id(6), itemId: id(9), version: 3 }]]);
  f.state.commitSha = 'c'.repeat(40); await expect(f.api.buildContext(f.build, f.revision)).rejects.toThrow('固定源码提交');
});

test('验证摘要随 beforeStart 配置变化，任务验证无需读取 Agent 秘密', async () => {
  const f = fixture(), version = RuntimeImageVersionDtoSchema.parse({ id: id(12), imageId: id(11), projectId: id(2), revisionId: id(10), buildId: id(8), repository: 'registry.test/tool', digest, architecture: 'linux/arm64', state: 'available', createdAt: '2026-09-27T00:00:00Z', initializerDigest: digest, toolsDigest: digest });
  const fingerprint = (usage: 'task' | 'agent') => f.api.validationContracts.fingerprint(actor, id(2), version, f.revision, usage === 'task' ? { usage } : { usage, profile: { profileId: id(4), revision: 2 } });
  const task = await fingerprint('task'), agent = await fingerprint('agent');
  f.state.beforeStart = { ...f.state.beforeStart, secrets: { NEW_TOKEN: 'rotated' } };
  expect(await fingerprint('task')).toBe(task); expect(await fingerprint('agent')).not.toBe(agent);
});

test('直接编写构建不借用业务仓库，撤销管理员后不能继续取得推送凭据', async () => {
  const f = fixture(), build = { ...f.build, projectId: undefined }, revision = RuntimeImageRevisionDtoSchema.parse({ ...f.revision, source: { kind: 'inline', dockerfileContent: 'FROM alpine', usage: 'service', architecture: 'linux/arm64' }, commitSha: undefined });
  f.state.admin = true;
  expect(await f.api.buildContext(build, revision)).toEqual({ namespace: 'cs-system', slug: 'platform', repositoryUrl: '' });
  expect(await f.api.credentials.packages(build, revision)).toEqual({});
  expect(f.calls).toEqual([]);
  await f.api.credentials.push(build, revision);
  expect(f.calls.map((c) => c.key)).toEqual(['push']);
  f.state.admin = false;
  await expect(f.api.buildContext(build, revision)).rejects.toMatchObject({ kind: 'forbidden' });
  await expect(f.api.credentials.push(build, revision)).rejects.toMatchObject({ kind: 'forbidden' });
});
