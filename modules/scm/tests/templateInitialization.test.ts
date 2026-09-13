import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectId, ServiceId } from '@crewstation/contracts';
import { directoryTemplateSource } from '../adapters/fs/directoryTemplateSource';
import { osScratchDirs } from '../adapters/fs/osScratchDirs';
import { ensureRepositoryUseCase } from '../application/ensureRepository';
import { listTemplatesUseCase } from '../application/listTemplates';
import { repositoryRoutes } from '../http/repositoryRoutes';
import { createApp } from '@crewstation/http';
import { IDENTITY_HEADERS } from '@crewstation/contracts';
import type { Actor, UserId } from '@crewstation/contracts';
import { TEST_SETTINGS, fakeGit, fakeGitLab, memoryUnitOfWork, mutableClock, recordingAuthorizer } from './fakeAdapters';

const tempDirs: string[] = [];
afterEach(async () => { await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
const serviceId = `svc_${'1'.repeat(32)}` as ServiceId;
const projectId = `prj_${'1'.repeat(32)}` as ProjectId;
const original = { apiVersion: 'crewstation/v1', kind: 'DigitalWorker', spec: { service: { command: ['bun', 'run', 'app.ts'], port: 3000, plan: 'standard-small' }, extension: { retained: true } } };

async function fixture(manifest = Bun.YAML.stringify(original)) {
  const root = await mkdtemp(join(tmpdir(), 'cs-template-init-'));
  tempDirs.push(root);
  await mkdir(join(root, 'custom-template'));
  await writeFile(join(root, 'custom-template', 'crewstation.yaml'), manifest);
  await writeFile(join(root, 'custom-template', 'README.md'), 'Chosen custom template');
  const templates = directoryTemplateSource({ templatesRoot: root });
  const gitlab = fakeGitLab();
  const git = fakeGit(gitlab);
  const memory = memoryUnitOfWork();
  const pushed: Array<{ manifest: unknown; readme: string }> = [];
  const ensure = ensureRepositoryUseCase({ uow: memory.uow, gitlab: gitlab.gateway, templates, scratch: osScratchDirs(), settings: TEST_SETTINGS,
    clock: mutableClock(), authorizer: recordingAuthorizer(), git: { ...git.runner, initAndPush: async (input) => {
      pushed.push({ manifest: Bun.YAML.parse(await readFile(join(input.workdir, 'crewstation.yaml'), 'utf8')), readme: await readFile(join(input.workdir, 'README.md'), 'utf8') });
      return git.runner.initAndPush(input);
    } },
  });
  return { root, templates, ensure, pushed, memory, gitlab };
}

describe('creation template initialization', () => {
  test('用户选定的套餐写进首次提交；原模板与未涉及的 Manifest 字段保持原样', async () => {
    const h = await fixture();
    await h.ensure(serviceId, projectId, { slug: 'demo', templateName: 'custom-template', initialPlan: 'standard-large' });
    // 修复创建页选择成功而初始仓库仍使用模板原套餐的断链。
    expect(h.pushed[0]).toEqual({ readme: 'Chosen custom template', manifest: { ...original, spec: { ...original.spec, service: { ...original.spec.service, plan: 'standard-large' } } } });
    expect(Bun.YAML.parse(await readFile(join(h.root, 'custom-template', 'crewstation.yaml'), 'utf8'))).toEqual(original);
    await h.ensure(serviceId, projectId, { slug: 'demo', templateName: 'missing-template', initialPlan: 'another-plan' });
    expect(h.pushed).toHaveLength(1);
  });

  test('首次推送已成功、保护标签失败后重跑，不覆盖远端分支或重写套餐', async () => {
    const h = await fixture();
    const protect = h.gitlab.gateway.ensureTagProtection;
    h.gitlab.gateway.ensureTagProtection = async () => { throw new Error('tag protection temporarily unavailable'); };
    await expect(h.ensure(serviceId, projectId, { slug: 'demo', templateName: 'custom-template', initialPlan: 'standard-large' })).rejects.toThrow('tag protection');
    expect(h.memory.bindings.get(serviceId)?.state).toBe('failed');
    h.gitlab.gateway.ensureTagProtection = protect;
    await h.ensure(serviceId, projectId, { slug: 'demo', templateName: 'missing-template', initialPlan: 'another-plan' });
    expect(h.pushed).toHaveLength(1);
    expect(h.memory.bindings.get(serviceId)?.state).toBe('ready');
  });

  test('未指定初始套餐的旧调用保留模板；非法 Manifest 不进行首次推送', async () => {
    const legacy = await fixture();
    await legacy.ensure(serviceId, projectId, { slug: 'demo', templateName: 'custom-template' });
    expect(legacy.pushed[0]?.manifest).toEqual(original);
    const invalid = await fixture('kind: Invalid');
    await expect(invalid.ensure(serviceId, projectId, { slug: 'demo', templateName: 'custom-template', initialPlan: 'standard-large' })).rejects.toMatchObject({ kind: 'validation' });
    expect(invalid.pushed).toHaveLength(0);
    expect(invalid.memory.bindings.get(serviceId)?.state).toBe('failed');
    const invalidPlan = await fixture();
    await expect(invalidPlan.ensure(serviceId, projectId, { slug: 'demo', templateName: 'custom-template', initialPlan: 'INVALID' })).rejects.toMatchObject({ kind: 'validation', details: { field: 'plan' } });
    expect(invalidPlan.pushed).toHaveLength(0);
  });

  test('模板目录从实际 Manifest 读取类型、套餐、必填键；双目录与自定义根按实际可用性处理', async () => {
    const templatesRoot = join(import.meta.dir, '../../../templates');
    const integrationTemplatesRoot = join(import.meta.dir, '../../../integrations');
    const source = directoryTemplateSource({ templatesRoot, integrationTemplatesRoot });
    const items = await source.list();
    expect(items.map((item) => [item.name, item.kind])).toEqual([
      ['gitlab-event-producer', 'EventProducer'], ['minimal-sample', 'DigitalWorker'], ['reference-api-proxy', 'APIProxy'],
    ]);
    expect(items[0]?.requiredConfig).toContainEqual({ name: 'GITLAB_WEBHOOK_SECRET_TOKEN', from: 'secret' });
    expect(items[1]?.requiredConfig).toEqual([]);
    const target = await fixture();
    expect((await target.templates.list()).map((item) => item.name)).toEqual(['custom-template']);
    await source.materialize('gitlab-event-producer', join(target.root, 'copied-integration'), 'standard-large');
    expect(Bun.YAML.parse(await readFile(join(target.root, 'copied-integration/crewstation.yaml'), 'utf8'))).toMatchObject({ kind: 'EventProducer', spec: { service: { plan: 'standard-large' } } });
    await expect(directoryTemplateSource({ templatesRoot: join(target.root, 'missing') }).list()).rejects.toThrow();
    await expect(directoryTemplateSource({ templatesRoot: target.root, integrationTemplatesRoot: target.root }).list()).rejects.toMatchObject({ kind: 'validation' });
    await expect((await fixture('invalid: true')).templates.list()).rejects.toMatchObject({ kind: 'validation' });
  });

  test('模板目录 HTTP 只给管理员；空目录与读取失败不同，不读取模板密钥值', async () => {
    const h = await fixture();
    const adminId = `usr_${'a'.repeat(32)}` as UserId;
    const resolveActor = async (userId: UserId): Promise<Actor> => ({ userId, isAdmin: userId === adminId });
    const app = createApp({ name: 'template-catalog' });
    const listTemplates = listTemplatesUseCase(h.templates);
    const unused = async (): Promise<never> => { throw new Error('unexpected repository call'); };
    app.route('/', repositoryRoutes({ listTemplates, getBinding: unused, listBranches: unused, listTags: unused }, resolveActor));
    const path = '/v1/catalog/project-templates';
    expect((await app.request(path)).status).toBe(401);
    expect((await app.request(path, { headers: { [IDENTITY_HEADERS.userId]: `usr_${'b'.repeat(32)}` } })).status).toBe(403);
    const response = await app.request(path, { headers: { [IDENTITY_HEADERS.userId]: adminId } });
    expect(await response.json()).toEqual({ items: [{ name: 'custom-template', kind: 'DigitalWorker', servicePlan: 'standard-small', requiredConfig: [] }] });
    await rm(join(h.root, 'custom-template'), { recursive: true });
    expect(await (await app.request(path, { headers: { [IDENTITY_HEADERS.userId]: adminId } })).json()).toEqual({ items: [] });
    await rm(h.root, { recursive: true });
    expect((await app.request(path, { headers: { [IDENTITY_HEADERS.userId]: adminId } })).status).toBe(503);
  });
});
