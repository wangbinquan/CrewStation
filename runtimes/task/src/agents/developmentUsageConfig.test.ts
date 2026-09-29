import { afterEach, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEVELOPMENT_USAGE_BINDING_DIRECTORY, DEVELOPMENT_USAGE_DIRECTORY, ProjectIdSchema, TaskIdSchema } from '@crewstation/contracts';
import { noopLogger } from '@crewstation/kernel';
import { loadConfigFromEnv } from '../config';
import { loadDevelopmentUsageConfig } from './developmentUsageConfig';
import { openDevelopmentUsage } from './openDevelopmentUsage';

const id = (n: number) => `019f0000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const base = { CS_TASK_ID: id(3), CS_RUNNER_TOKEN: 'private-token', CS_SESSION_URL: 'ws://session.test/' };
const selected = { version: 1 as const, directory: DEVELOPMENT_USAGE_DIRECTORY, bindingDirectory: DEVELOPMENT_USAGE_BINDING_DIRECTORY, projectId: ProjectIdSchema.parse(id(1)), workspaceTaskId: TaskIdSchema.parse(id(2)) };
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true }); });

test('only explicit canonical development render and a Pod identity enable the numeric configuration', () => {
  expect(loadDevelopmentUsageConfig(base)).toBeUndefined();
  expect(loadConfigFromEnv(base).developmentUsage).toBeUndefined();
  const env = { ...base, CS_RUNTIME_POD_UID: 'pod-a', CS_RUNNER_DEVELOPMENT_USAGE: JSON.stringify(selected) };
  expect(loadConfigFromEnv(env).developmentUsage).toEqual({ ...selected, podUid: 'pod-a' });
  for (const raw of ['', 'invalid-json', JSON.stringify({ ...selected, version: 2 }), JSON.stringify({ ...selected, directory: '/work' }), JSON.stringify({ ...selected, bindingDirectory: DEVELOPMENT_USAGE_DIRECTORY }), JSON.stringify({ ...selected, projectId: 'project-slug' }), 'x'.repeat(4097)]) expect(() => loadDevelopmentUsageConfig({ ...env, CS_RUNNER_DEVELOPMENT_USAGE: raw })).toThrow('配置或 Pod 身份');
  expect(() => loadDevelopmentUsageConfig({ ...env, CS_RUNTIME_POD_UID: undefined })).toThrow('配置或 Pod 身份');
});

test('the private journal opens without changing the worker home, and unsafe mounts provide no capability', () => {
  const root = mkdtempSync(join(tmpdir(), 'cs-development-config-')); roots.push(root);
  const bindingRoot = mkdtempSync(join(tmpdir(), 'cs-development-binding-')); roots.push(bindingRoot);
  const config = { ...loadConfigFromEnv(base), developmentUsage: { version: 1 as const, directory: root, bindingDirectory: bindingRoot, projectId: ProjectIdSchema.parse(id(1)), workspaceTaskId: TaskIdSchema.parse(id(2)), podUid: 'pod-a' } };
  expect(openDevelopmentUsage({ ...config, developmentUsage: undefined }, noopLogger)).toBeUndefined();
  const first = openDevelopmentUsage(config, noopLogger)!;
  expect(first.info()).toMatchObject({ receipt: null, runtimeTaskId: id(3), podUid: 'pod-a' });
  const journalId = first.journalId; first.close();
  const reopened = openDevelopmentUsage(config, noopLogger)!;
  expect(reopened.journalId).toBe(journalId); reopened.close();
  chmodSync(root, 0o777);
  expect(openDevelopmentUsage(config, noopLogger)).toBeUndefined();
});

function store() {
  const directory = mkdtempSync(join(tmpdir(), 'cs-development-numeric-')), bindingDirectory = mkdtempSync(join(tmpdir(), 'cs-development-binding-'));
  roots.push(directory, bindingDirectory);
  return { ...loadConfigFromEnv(base), developmentUsage: { ...selected, directory, bindingDirectory, podUid: 'pod-a' } };
}

test('loss of the entire numeric store cannot advertise a fresh capability in the same Pod', () => {
  const config = store(), original = openDevelopmentUsage(config, noopLogger)!;
  const journalId = original.journalId; original.close();
  rmSync(join(config.developmentUsage.directory, 'journal'), { recursive: true });
  expect(openDevelopmentUsage(config, noopLogger)).toBeUndefined();
  expect(existsSync(join(config.developmentUsage.directory, 'journal'))).toBe(false);
  expect(existsSync(join(config.developmentUsage.bindingDirectory, 'binding/store.binding'))).toBe(true);
  expect(journalId).toHaveLength(36);
});

test('a missing independent binding, changed physical identity, or substituted numeric identity cannot become a new start', () => {
  const config = store(), original = openDevelopmentUsage(config, noopLogger)!; original.close();
  expect(openDevelopmentUsage({ ...config, developmentUsage: { ...config.developmentUsage, podUid: 'replacement-pod' } }, noopLogger)).toBeUndefined();
  expect(openDevelopmentUsage({ ...config, developmentUsage: { ...config.developmentUsage, projectId: ProjectIdSchema.parse(id(9)) } }, noopLogger)).toBeUndefined();
  const marker = join(config.developmentUsage.directory, 'journal/journal.identity');
  writeFileSync(marker, crypto.randomUUID());
  expect(openDevelopmentUsage(config, noopLogger)).toBeUndefined();
  rmSync(join(config.developmentUsage.bindingDirectory, 'binding'), { recursive: true });
  expect(openDevelopmentUsage(config, noopLogger)).toBeUndefined();
  expect(existsSync(join(config.developmentUsage.directory, 'journal/executions.sqlite'))).toBe(true);
});
