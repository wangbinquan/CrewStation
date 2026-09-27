import { expect, test } from 'bun:test';
import { RuntimeImageRevisionDtoSchema, RuntimeImageSourceSchema } from '@crewstation/contracts';
import { runtimeImageSourcePreparation } from '../application/sourcePreparation';
import { runtimeImageBuildSecretValues } from '../application/buildSecretValues';
import { runtimeImageBuildPlan } from '../domain/buildPlan';
import { k8sBuildFixture } from './k8sBuildFixture';
import { actor } from './runtimeImageFixture';

const source = () => RuntimeImageSourceSchema.parse({ kind: 'inline', architecture: 'linux/amd64', usage: 'task', dockerfileContent: 'ARG CS_BASE_IMAGE\nFROM ${CS_BASE_IMAGE}', files: [{ path: 'bin/tool', executable: true, contentBase64: btoa('\0\xff\x80') }] });
const unavailable = async (): Promise<never> => { throw new Error('inline 不应访问源码仓库或凭据'); };

test('直接编写不读取业务仓库，仍检查平台底座、Dockerfile 与 Agent 档位', async () => {
  let base = `registry.test/task@sha256:${'a'.repeat(64)}`;
  const prepare = runtimeImageSourcePreparation({ resolve: unavailable, readFile: unavailable }, { resolve: async () => base }, { resolve: unavailable }).prepare;
  const recipe = source();
  expect(await prepare(actor(true), undefined, recipe)).toEqual({ source: recipe, baseImage: base });
  await expect(prepare(actor(true), undefined, { ...recipe, usage: 'agent' })).rejects.toThrow('固定算力档位');
  await expect(prepare(actor(true), undefined, RuntimeImageSourceSchema.parse({ ...recipe, dockerfileContent: 'FROM alpine' }))).rejects.toThrow('声明 ARG');
  if (recipe.kind !== 'inline') throw new Error('inline');
  await expect(prepare(actor(true), undefined, { ...recipe, baseProfile: { profileId: actor().userId, revision: 1 } })).rejects.toThrow('只有 Agent');
  expect(await prepare(actor(true), undefined, { ...recipe, usage: 'agent', baseProfile: { profileId: actor().userId, revision: 1 } })).toMatchObject({ baseImage: base });
  base = 'registry.test/task:latest';
  await expect(prepare(actor(true), undefined, recipe)).rejects.toThrow('未固定摘要');
});

test('直接编写用隔离 BuildKit 计划，内容不进 argv，Secret 没有 Git token 且取消不继续签发', async () => {
  const f = k8sBuildFixture(), revision = RuntimeImageRevisionDtoSchema.parse({ ...f.revision, source: source(), commitSha: undefined });
  const plan = runtimeImageBuildPlan(f.build(), revision, { namespace: 'cs-system', slug: 'platform', repositoryUrl: '' }, { clientImage: 'client', builderImage: 'builder', registryBase: 'registry.internal:5000', pushHost: 'registry.example', pushInsecure: true, builderResources: f.plan.builderResources, clientResources: f.plan.clientResources, workspaceSize: '1Gi', cacheSize: '1Gi' }, new Date(revision.createdAt));
  expect(plan).toMatchObject({ inlineFileCount: 1, secretIds: [] });
  expect(plan.checkoutCommand.join(' ')).not.toContain('git');
  expect(plan.checkoutCommand.join(' ')).not.toContain('AP+A');
  expect(plan.clientCommand.join(' ')).toContain('filename=Dockerfile');
  f.update({ resourcePlan: plan });
  const get = runtimeImageBuildSecretValues(f.intents, { ...f.credentials, issueGit: unavailable, revokeGit: unavailable }, async () => revision);
  const input = { recordId: plan.resourceId, buildId: plan.buildId, executionEpoch: 1 };
  const values = await get(input);
  expect(values).toMatchObject({ 'context-file-0': 'AP+A', 'context-dockerfile': 'ARG CS_BASE_IMAGE\nFROM ${CS_BASE_IMAGE}' });
  expect(values).not.toHaveProperty('git-token'); expect(f.build().gitCredentialIds).toBeUndefined();
  f.update({ resourcePlan: { ...plan, inlineFileCount: 0 } });
  await expect(get(input)).rejects.toThrow('固定修订');
  f.update({ state: 'cancelling' }); await expect(get(input)).rejects.toThrow('已结束');
});
