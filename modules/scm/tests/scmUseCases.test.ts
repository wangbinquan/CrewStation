import { describe, expect, test } from 'bun:test';
import type { Actor, ProjectId, ServiceId, UserId } from '@crewstation/contracts';
import { forbidden } from '@crewstation/kernel';
import { createReleaseTagUseCase } from '../application/createReleaseTag';
import type { ScmUseCaseDeps } from '../application/dependencies';
import { ensureRepositoryUseCase } from '../application/ensureRepository';
import { pushBranchUseCase } from '../application/pushBranch';
import { queryRepositoryUseCases } from '../application/queryRepository';
import { sessionCredentialUseCases } from '../application/sessionCredentials';
import { hashToken } from '../domain/sessionCredential';
import { TEST_SETTINGS, fakeGit, fakeGitLab, fakeScratch, fakeTemplates, memoryUnitOfWork, mutableClock, recordingAuthorizer } from './fakeAdapters';

const serviceId = '01a0bf5d-8f4b-7f20-83c3-08a8d54951b2' as ServiceId;
const otherServiceId = '01a0bf5d-8f4b-76be-8473-58312e41bdd7' as ServiceId;
const projectId = '01a0bf5d-8f4b-7148-804c-6bd655d243f6' as ProjectId;
const actor: Actor = { userId: '01a0bf5d-8f4b-759b-8091-838671643836' as UserId, isAdmin: false };
const input = { slug: 'demo', templateId: '01a0bf5d-8f4b-7002-9560-94caf593fb19' };
const PUSH_URL = 'http://crewstation:glpat-platform-secret@gitlab.test:8929/crewstation/demo.git';

function harness() {
  const gitlab = fakeGitLab();
  const git = fakeGit(gitlab);
  const templates = fakeTemplates();
  const scratch = fakeScratch();
  const memory = memoryUnitOfWork();
  const clock = mutableClock();
  const authorizer = recordingAuthorizer();
  const deps: ScmUseCaseDeps = { uow: memory.uow, gitlab: gitlab.gateway, git: git.runner, templates: templates.source, scratch: scratch.dirs, authorizer, settings: TEST_SETTINGS, clock };
  return {
    gitlab, git, templates, scratch, memory, clock, authorizer,
    ensure: ensureRepositoryUseCase(deps),
    query: queryRepositoryUseCases(deps),
    tag: createReleaseTagUseCase(deps),
    credentials: sessionCredentialUseCases(deps),
    push: pushBranchUseCase(deps),
  };
}

describe('ensureRepository', () => {
  test('建仓全流程后 ready；重复调用幂等，不再建仓也不再推送', async () => {
    const h = harness();
    const dto = await h.ensure(serviceId, projectId, input);
    expect(dto).toMatchObject({ serviceId, provider: 'gitlab', remoteProjectId: '100', pathWithNamespace: 'crewstation/demo', httpUrl: 'http://gitlab.test:8929/crewstation/demo.git', defaultBranch: 'main', state: 'ready', createdAt: '2026-09-11T10:00:00.000Z' });
    expect(dto.message).toBeUndefined();
    expect(h.gitlab.calls).toEqual(['findProject crewstation/demo', 'createProject crewstation/demo', 'protect v*']);
    expect(h.templates.materialized).toEqual([{ templateId: '01a0bf5d-8f4b-7002-9560-94caf593fb19', targetDir: '/scratch/cs-scm-init-1' }]);
    expect(h.scratch.removed).toEqual(['/scratch/cs-scm-init-1']);
    expect(h.git.pushes).toEqual([{ kind: 'init', workdir: '/scratch/cs-scm-init-1', url: PUSH_URL, branch: 'main' }]);
    expect(await h.ensure(serviceId, projectId, input)).toEqual(dto);
    expect(h.gitlab.calls).toHaveLength(3);
    expect(h.git.pushes).toHaveLength(1);
  });

  test('远端已有同路径项目且未绑定 → conflict，不建仓、不推送、不落绑定（R32／AT-25）', async () => {
    const h = harness();
    h.gitlab.add('crewstation/demo', '7');
    await expect(h.ensure(serviceId, projectId, input)).rejects.toMatchObject({ kind: 'conflict', details: { pathWithNamespace: 'crewstation/demo', remoteProjectId: '7' } });
    expect(h.gitlab.calls).toEqual(['findProject crewstation/demo']);
    expect(h.git.pushes).toHaveLength(0);
    expect(h.memory.bindings.size).toBe(0);
  });

  test('路径已绑定到别的服务 → conflict', async () => {
    const h = harness();
    await h.ensure(otherServiceId, projectId, input);
    await expect(h.ensure(serviceId, projectId, input)).rejects.toMatchObject({ kind: 'conflict' });
    expect(h.memory.bindings.has(serviceId)).toBe(false);
  });

  test('推送失败 → failed 并记录原因；重试复用本服务上次建出的远端项目并成功', async () => {
    const h = harness();
    h.git.failNextPushes(1);
    await expect(h.ensure(serviceId, projectId, input)).rejects.toMatchObject({ kind: 'unavailable' });
    expect(h.memory.bindings.get(serviceId)).toMatchObject({ state: 'failed', remoteProjectId: '100', message: expect.stringContaining('git push 失败') });
    expect(h.scratch.removed).toHaveLength(1);
    const dto = await h.ensure(serviceId, projectId, input);
    expect(dto).toMatchObject({ state: 'ready', remoteProjectId: '100' });
    expect(dto.message).toBeUndefined();
    expect(h.gitlab.calls.filter((c) => c.startsWith('createProject'))).toHaveLength(1);
    expect(h.git.pushes).toHaveLength(1);
  });

  test('重试时远端默认分支已存在 → 不再推模板，只补标签保护', async () => {
    const h = harness();
    h.git.failNextPushes(1);
    await h.ensure(serviceId, projectId, input).catch(() => undefined);
    h.gitlab.setBranch('100', 'main', 'f'.repeat(40), true);
    expect((await h.ensure(serviceId, projectId, input)).state).toBe('ready');
    expect(h.git.pushes).toHaveLength(0);
    expect(h.templates.materialized).toHaveLength(1);
    expect(h.gitlab.calls.filter((c) => c === 'protect v*')).toHaveLength(1);
  });

  test('失败尝试之后远端项目被换掉（ID 不同）→ conflict，不接管', async () => {
    const h = harness();
    h.git.failNextPushes(1);
    await h.ensure(serviceId, projectId, input).catch(() => undefined);
    h.gitlab.projects.delete('100');
    h.gitlab.add('crewstation/demo', '200');
    await expect(h.ensure(serviceId, projectId, input)).rejects.toMatchObject({ kind: 'conflict', details: { remoteProjectId: '200' } });
    expect(h.memory.bindings.get(serviceId)?.state).toBe('failed');
  });

  test('模板不存在 → not_found 并落 failed，临时目录被清理', async () => {
    const h = harness();
    await expect(h.ensure(serviceId, projectId, { slug: 'demo', templateId: '01a0bf5d-8f4b-7ffa-8635-83dfa6706b87' })).rejects.toMatchObject({ kind: 'not_found' });
    expect(h.memory.bindings.get(serviceId)).toMatchObject({ state: 'failed', message: expect.stringContaining('模板 01a0bf5d-8f4b-7ffa-8635-83dfa6706b87 不存在') });
    expect(h.scratch.removed).toHaveLength(1);
    expect(h.git.pushes).toHaveLength(0);
  });
});

describe('createReleaseTag', () => {
  test('远端分支已离开确认 SHA 时拒绝打标；确认后前进仍只给确认提交打标', async () => {
    const h = harness(); await h.ensure(serviceId, projectId, input);
    const confirmed = h.gitlab.get('100').branches.get('main')!.headSha;
    await expect(h.tag(serviceId, { branch: 'main', bump: 'patch', expectedCommitSha: 'f'.repeat(40) })).rejects.toMatchObject({ kind: 'conflict', details: { actual: confirmed } });
    expect(h.gitlab.get('100').tags).toHaveLength(0);
    const create = h.gitlab.gateway.createTag;
    h.gitlab.gateway.createTag = async (id, value) => {
      h.gitlab.setBranch(id, 'main', 'b'.repeat(40));
      return create(id, value);
    };
    expect(await h.tag(serviceId, { branch: 'main', bump: 'patch', expectedCommitSha: confirmed })).toEqual({ tag: 'v0.0.1', commitSha: confirmed });
    expect(h.gitlab.get('100').branches.get('main')?.headSha).toBe('b'.repeat(40));
  });

  test('无标签 minor→v0.1.0；patch→v0.1.1；显式 v2.0.0；手工标签被忽略；已存在→conflict；分支不存在→not_found', async () => {
    const h = harness();
    await h.ensure(serviceId, projectId, input);
    const headSha = h.gitlab.get('100').branches.get('main')?.headSha;
    expect(await h.tag(serviceId, { branch: 'main', bump: 'minor' })).toEqual({ tag: 'v0.1.0', commitSha: headSha ?? '' });
    h.gitlab.get('100').tags.push({ name: 'manual-tag', commitSha: headSha ?? '', createdAt: '2026-09-11T00:00:00.000Z', protected: false });
    expect((await h.tag(serviceId, { branch: 'main', bump: 'patch' })).tag).toBe('v0.1.1');
    expect((await h.tag(serviceId, { branch: 'main', tag: 'v2.0.0' })).tag).toBe('v2.0.0');
    expect((await h.tag(serviceId, { branch: 'main', bump: 'patch' })).tag).toBe('v2.0.1');
    await expect(h.tag(serviceId, { branch: 'main', tag: 'v2.0.0' })).rejects.toMatchObject({ kind: 'conflict' });
    await expect(h.tag(serviceId, { branch: 'nope', bump: 'patch' })).rejects.toMatchObject({ kind: 'not_found' });
    await expect(h.tag(serviceId, { branch: 'main', tag: 'v2' })).rejects.toMatchObject({ kind: 'validation' });
    await expect(h.tag(serviceId, { branch: 'main' })).rejects.toMatchObject({ kind: 'validation' });
    await expect(h.tag(otherServiceId, { branch: 'main', bump: 'patch' })).rejects.toMatchObject({ kind: 'not_found' });
    expect(h.gitlab.get('100').tags.filter((t) => t.protected).map((t) => t.name)).toEqual(['v0.1.0', 'v0.1.1', 'v2.0.0', 'v2.0.1']);
  });

  test('未就绪的仓库不能打标（precondition）', async () => {
    const h = harness();
    h.git.failNextPushes(1);
    await h.ensure(serviceId, projectId, input).catch(() => undefined);
    await expect(h.tag(serviceId, { branch: 'main', bump: 'patch' })).rejects.toMatchObject({ kind: 'precondition', details: { state: 'failed' } });
  });
});

describe('session credentials', () => {
  test('明文只返回一次、库里只有哈希；到期后 revokeExpiredCredentials 撤销远端令牌', async () => {
    const h = harness();
    await h.ensure(serviceId, projectId, input);
    const issued = await h.credentials.issueSessionCredential(serviceId, 30);
    expect(issued.token).toStartWith('glpat-fake-1-');
    expect(issued.expiresAt).toBe('2026-09-11T10:30:00.000Z');
    expect(issued.httpUrlWithCredentialTemplate).toBe('http://cs-session:{token}@gitlab.test:8929/crewstation/demo.git');
    const stored = [...h.memory.credentials.values()];
    expect(stored).toHaveLength(1);
    const credential = stored[0];
    expect(credential).toMatchObject({ serviceId, remoteTokenId: '1', tokenHash: hashToken(issued.token) });
    expect(JSON.stringify(credential)).not.toContain(issued.token);
    expect(h.gitlab.get('100').tokens.get('1')).toEqual({ name: `cs-session-${credential?.id}`, expiresOn: '2026-09-12', revoked: false });
    expect(await h.credentials.revokeExpiredCredentials()).toBe(0);
    h.clock.advanceMinutes(31);
    expect(await h.credentials.revokeExpiredCredentials()).toBe(1);
    expect(h.gitlab.get('100').tokens.get('1')?.revoked).toBe(true);
    expect(h.memory.credentials.get(credential?.id ?? '')?.revokedAt).toEqual(h.clock.now());
    expect(await h.credentials.revokeExpiredCredentials()).toBe(0);
    await expect(h.credentials.issueSessionCredential(serviceId, 0)).rejects.toMatchObject({ kind: 'validation' });
    await expect(h.credentials.issueSessionCredential(otherServiceId, 5)).rejects.toMatchObject({ kind: 'not_found' });
  });
});

describe('queries', () => {
  test('listBranches：落后数来自 compare，未给出槽提交或引用未知为 null；授权 view', async () => {
    const h = harness();
    await h.ensure(serviceId, projectId, input);
    const mainSha = h.gitlab.get('100').branches.get('main')?.headSha ?? '';
    const featureSha = 'b'.repeat(40);
    const previewSha = 'c'.repeat(40);
    h.gitlab.setBranch('100', 'feature', featureSha);
    h.gitlab.behind.set(`${mainSha}..${previewSha}`, 0);
    h.gitlab.behind.set(`${featureSha}..${previewSha}`, 3);
    expect(await h.query.listBranches(actor, serviceId, { previewSha })).toEqual([
      { name: 'main', headSha: mainSha, isDefault: true, behindPreview: 0, behindProd: null },
      { name: 'feature', headSha: featureSha, isDefault: false, behindPreview: 3, behindProd: null },
    ]);
    expect(h.authorizer.calls).toEqual([`${actor.userId}:${projectId}:view`]);
    const unknownProd = await h.query.listBranches(actor, serviceId, { prodSha: 'd'.repeat(40) });
    expect(unknownProd.map((b) => [b.behindPreview, b.behindProd])).toEqual([[null, null], [null, null]]);
  });

  test('getBinding 返回任何状态；listTags 要求就绪；未知服务 not_found；forbidden 透传', async () => {
    const h = harness();
    h.git.failNextPushes(1);
    await h.ensure(serviceId, projectId, input).catch(() => undefined);
    expect((await h.query.getBinding(actor, serviceId)).state).toBe('failed');
    await expect(h.query.listTags(actor, serviceId)).rejects.toMatchObject({ kind: 'precondition' });
    await expect(h.query.getBinding(actor, otherServiceId)).rejects.toMatchObject({ kind: 'not_found' });
    h.authorizer.authorize = async () => { throw forbidden(); };
    await expect(h.query.getBinding(actor, serviceId)).rejects.toMatchObject({ kind: 'forbidden' });
  });
});

describe('pushBranch', () => {
  test('用平台令牌推送指定分支；未知服务 not_found', async () => {
    const h = harness();
    await h.ensure(serviceId, projectId, input);
    const result = await h.push(serviceId, '/work/dir', 'feature');
    expect(result.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(h.git.pushes.at(-1)).toEqual({ kind: 'push', workdir: '/work/dir', branch: 'feature', url: PUSH_URL });
    await expect(h.push(otherServiceId, '/w', 'main')).rejects.toMatchObject({ kind: 'not_found' });
  });
});
