import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { isExcepted, loadExceptions } from '../exceptions';
import { RULES } from '../ruleSet';
import { cycles } from '../rules/cycles';
import { declaredDependencies } from '../rules/declaredDependencies';
import { dependencyDirection } from '../rules/dependencyDirection';
import { migrationLock } from '../rules/migrationLock';
import { moduleTemplate } from '../rules/moduleTemplate';
import { persistenceOwnership } from '../rules/persistenceOwnership';
import { sizeAndNaming } from '../rules/sizeAndNaming';
import { testDiscipline } from '../rules/testDiscipline';
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

describe('test-discipline', () => {
  const messages = (file: string): string => messagesOf(testDiscipline(ws), file).join();
  test('让同文件其余用例静默失效的 only', () => {
    expect(messages('modules/low/tests/focused.test.ts')).toContain('禁止提交 .only');
  });
  test('无条件跳过、占位用例与已知失败', () => {
    const found = messages('modules/low/tests/parked.test.ts');
    expect(found).toContain('禁止无条件 .skip');
    expect(found).toContain('禁止 .todo');
    expect(found).toContain('禁止 .failing');
  });
  test('恒真的 skipIf 与用例重试', () => {
    const found = messages('packages/kernel/flaky.test.ts');
    expect(found).toContain('恒真的 skipIf');
    expect(found).toContain('禁止用例重试');
  });
  test('注释里提到这些写法不算违规；由环境探测驱动的 skipIf 是允许的', () => {
    expect(messages('modules/low/tests/gated.test.ts')).toBe('');
  });
  test('工作区之外由根 bun test 收进来的用例同样受约束', () => {
    expect(messages('integrations/sample/src/main.test.ts')).toContain('禁止提交 .only');
  });
  test('仓库根 tests/ 只允许约定的用例层目录，不散放文件', () => {
    expect(messages('tests/misc')).toContain('只允许用例层目录');
    expect(messages('tests/loose.test.ts')).toContain('不散放文件');
    expect(messages('tests/e2e')).toBe('');
  });
});

describe('migration-lock', () => {
  const messages = (file: string): string => messagesOf(migrationLock(ws), file).join();
  const dir = 'modules/high/adapters/persistence/migrations';
  test('已入锁的迁移被修改', () => {
    expect(messages(`${dir}/0001_create_schema.sql`)).toContain('不可修改');
  });
  test('已入锁的迁移被删除', () => {
    expect(messages(`${dir}/0002_gone.sql`)).toContain('被删除或改名');
  });
  test('新迁移尚未入锁', () => {
    expect(messages(`${dir}/0004_fresh.sql`)).toContain('尚未入锁');
  });
  test('新迁移的序号不大于已入锁的最大序号就是插队', () => {
    expect(messages(`${dir}/0003_late.sql`)).toContain('必须大于同目录已入锁的最大序号 0003');
  });
  test('内容与锁一致的迁移不报', () => {
    expect(messages(`${dir}/0003_locked.sql`)).toBe('');
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
    expect(RULES.flatMap((rule) => rule(real))).toEqual([]);
  });
});
