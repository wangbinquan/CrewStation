import { describe, expect, test } from 'bun:test';
import type { Actor } from '@crewstation/contracts';
import { ProjectIdSchema } from '@crewstation/contracts';
import { newResourceId, noopLogger, systemClock } from '@crewstation/kernel';
import { registryProjects } from './registryProjects';
import { runtimeImageUseCases } from './runtimeImages';

describe('旧构建凭据与项目仓库请求的来源身份', () => {
  test('旧签名scope、目标和mount来源共同核对；不把全局目录或其他只读许可当作当前来源', () => {
    const a = ProjectIdSchema.parse(newResourceId()), b = ProjectIdSchema.parse(newResourceId()), c = ProjectIdSchema.parse(newResourceId());
    expect(registryProjects({ sub: 'build', exp: 9999999999, push: [`runtime/projects/${a}/build/`], pull: [`runtime/projects/${c}/build/image`] }, `/v2/runtime/projects/${b}/build/image/blobs/uploads/?from=runtime%2Fprojects%2F${a}%2Fbuild%2Fimage`)).toEqual([a, b].sort());
    expect(registryProjects({ sub: 'admin', exp: 9999999999, push: ['runtime/'], pull: ['crewstation/task-runtime'] }, '/v2/runtime/shared/manifests/v1')).toEqual([]);
    expect(() => registryProjects({ sub: 'admin', exp: 9999999999, push: ['runtime/'], pull: [] }, '/v2/runtime/projects/invalid/image/manifests/v1')).toThrow();
  });
  test('准入来源失联拒绝已签发凭据，不泄露源错误；全局请求仍有正常权限裁定', async () => {
    const layout = { pullBase: 'registry.test', pushHost: 'registry.test', baseRepository: 'crewstation/task-runtime', runtimePrefix: 'runtime/' };
    let unavailable = false;
    const api = runtimeImageUseCases({ registry: { layout, resolveDigest: async () => `sha256:${'1'.repeat(64)}` }, clock: systemClock, logger: noopLogger }, { signingKey: new TextEncoder().encode('fixture-signing-key'), baseTag: 'dev', ttlSeconds: 600 }, async () => { if (unavailable) throw new Error('private-source-error'); });
    const projectId = newResourceId(), token = await api.issueBuildPushCredential({ projectId, buildId: newResourceId(), expiresAt: new Date(Date.now() + 600000).toISOString(), pullRepositories: [layout.baseRepository] });
    const authorization = `Basic ${Buffer.from(`${token.username}:${token.password}`).toString('base64')}`;
    const input = { authorization, method: 'GET', uri: '/v2/' };
    expect(await api.authorizeRegistryRequest(input)).toEqual({ status: 200 });
    unavailable = true;
    expect(await api.authorizeRegistryRequest(input)).toEqual({ status: 403, reason: '相关项目已关闭镜像访问或当前无法验证准入' });
    await expect(api.issueBuildPushCredential({ projectId, buildId: newResourceId(), expiresAt: new Date(Date.now() + 600000).toISOString(), pullRepositories: [] })).rejects.toThrow();
    const shared = await api.issuePushCredential({ userId: newResourceId(), isAdmin: true } as Actor);
    expect(await api.authorizeRegistryRequest({ ...input, authorization: `Basic ${Buffer.from(`${shared.username}:${shared.password}`).toString('base64')}` })).toEqual({ status: 200 });
  });
});
