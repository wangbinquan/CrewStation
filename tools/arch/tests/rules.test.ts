import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { isExcepted, loadExceptions } from '../exceptions';
import { cycles } from '../rules/cycles';
import { declaredDependencies } from '../rules/declaredDependencies';
import { dependencyDirection } from '../rules/dependencyDirection';
import { moduleTemplate } from '../rules/moduleTemplate';
import { persistenceOwnership } from '../rules/persistenceOwnership';
import { sizeAndNaming } from '../rules/sizeAndNaming';
import type { Violation, Workspace } from '../archModel';
import { loadWorkspace } from '../workspace';
import { createViolatingWorkspace } from './fixtureWorkspace';

let root = '';
let ws: Workspace;
const messagesOf = (violations: Violation[], file: string): string[] =>
  violations.filter((v) => relative(root, v.file) === file).map((v) => v.message);

beforeAll(() => {
  root = createViolatingWorkspace();
  ws = loadWorkspace(root);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('dependency-direction', () => {
  test('技术包不能依赖模块', () => {
    expect(messagesOf(dependencyDirection(ws), 'packages/persistence/index.ts').join()).toContain('技术包不能依赖模块');
  });
  test('模块只能依赖 layer 更小的模块', () => {
    expect(messagesOf(dependencyDirection(ws), 'modules/low/wiring.ts').join()).toContain('layer 更小');
  });
  test('其他模块只能在 wiring.ts 或 tests/ 中 import', () => {
    expect(messagesOf(dependencyDirection(ws), 'modules/high/application/useCase.ts').join()).toContain('wiring.ts');
  });
  test('console 只能依赖白名单技术包', () => {
    expect(messagesOf(dependencyDirection(ws), 'apps/console/src/main.ts').join()).toContain('只允许依赖技术包');
  });
});

describe('module-template', () => {
  test('domain/ 不能 import adapters/', () => {
    expect(messagesOf(moduleTemplate(ws), 'modules/low/domain/thing.ts').join()).toContain('不能 import 同模块的 adapters/');
  });
  test('禁止深路径 import 模块', () => {
    expect(messagesOf(moduleTemplate(ws), 'modules/high/wiring.ts').join()).toContain('只能 import 根入口');
  });
  test('模块根目录不允许模板外文件', () => {
    expect(messagesOf(moduleTemplate(ws), 'modules/low/utils.ts').join()).toContain('不允许出现');
  });
});

describe('persistence-ownership', () => {
  test('只能使用本模块 schema', () => {
    expect(messagesOf(persistenceOwnership(ws), 'modules/low/adapters/persistence/repo.ts').join()).toContain("pgSchema('low')");
  });
  test('迁移 SQL 必须带前缀且不碰其他 schema', () => {
    const messages = messagesOf(persistenceOwnership(ws), 'modules/low/adapters/persistence/migrations/0001_init.sql');
    expect(messages.some((m) => m.includes('必须带 schema 前缀'))).toBe(true);
    expect(messages.some((m) => m.includes('其他 schema'))).toBe(true);
  });
});

describe('size-limit / banned-name / no-default-export', () => {
  test('超过 600 行', () => {
    expect(messagesOf(sizeAndNaming(ws), 'packages/kernel/big.ts').join()).toContain('超过上限 600');
  });
  test('禁用 utils.ts', () => {
    expect(messagesOf(sizeAndNaming(ws), 'modules/low/utils.ts').join()).toContain('杂物箱');
  });
  test('禁止默认导出', () => {
    expect(messagesOf(sizeAndNaming(ws), 'packages/kernel/def.ts').join()).toContain('默认导出');
  });
});

describe('declared-dependencies 与 no-cycles', () => {
  test('未声明的 npm 依赖', () => {
    expect(messagesOf(declaredDependencies(ws), 'modules/low/adapters/persistence/repo.ts').join()).toContain('drizzle-orm');
  });
  test('模块环', () => {
    expect(cycles(ws).some((v) => v.message.includes('modules/low') && v.message.includes('modules/high'))).toBe(true);
  });
});

describe('ADR 例外', () => {
  test('过期例外失效，有效例外放行', () => {
    const { active, expired } = loadExceptions(root, new Date('2026-09-11'));
    expect(expired.map((e) => e.pattern)).toEqual(['packages/kernel/big.ts']);
    expect(isExcepted(active, 'no-default-export', 'packages/kernel/def.ts')).toBe(true);
    expect(isExcepted(active, 'size-limit', 'packages/kernel/big.ts')).toBe(false);
  });
});

describe('真实仓库', () => {
  test('当前仓库无违规', () => {
    const real = loadWorkspace(resolve(import.meta.dir, '..', '..', '..'));
    const all = [dependencyDirection, moduleTemplate, persistenceOwnership, sizeAndNaming, declaredDependencies, cycles].flatMap((rule) => rule(real));
    expect(all).toEqual([]);
  });
});
