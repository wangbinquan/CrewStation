import { describe, expect, test } from 'bun:test';
import { renderModuleFiles } from '../moduleTemplate';

const spec = { name: 'order-billing', layer: 3, deps: ['project'], desc: '订单计费', persistence: true, drizzleVersion: '0.45.2' };

describe('模块脚手架', () => {
  // 「新功能有防护用例的位置」从模块出生那一刻就要成立：用例目录、夹具包依赖与写法指引都由模板给出。
  test('新模块自带集成用例文件、testkit 依赖与用例规范的指引', () => {
    const files = renderModuleFiles(spec);
    const suite = files['tests/orderBillingModule.test.ts'];
    expect(suite).toContain("import { createOrderBillingModule } from '../wiring';");
    expect(suite).toContain('docs/engineering/testing.md');
    expect(suite).not.toContain('{{');
    expect((JSON.parse(files['package.json']!) as { devDependencies: Record<string, string> }).devDependencies).toEqual({ '@crewstation/testkit': 'workspace:*' });
    expect(files['README.md']).toContain('docs/engineering/testing.md');
  });

  test('模板目录齐全；带持久化时生成本模块 schema 的首个迁移，不带时不生成', () => {
    const files = renderModuleFiles(spec);
    for (const path of ['index.ts', 'wiring.ts', 'api/moduleApi.ts', 'domain/.gitkeep', 'application/.gitkeep', 'ports/.gitkeep', 'http/.gitkeep', 'workers/.gitkeep']) expect(files[path]).toBeDefined();
    expect(files['adapters/persistence/migrations/0001_create_schema.sql']).toBe('CREATE SCHEMA IF NOT EXISTS order_billing;\n');
    const bare = renderModuleFiles({ ...spec, persistence: false });
    expect(Object.keys(bare).filter((path) => path.includes('migrations'))).toEqual([]);
    expect(bare['adapters/.gitkeep']).toBe('');
  });

  test('依赖的模块与层写进 package.json，名字按 kebab 转换', () => {
    const pkg = JSON.parse(renderModuleFiles(spec)['package.json']!) as { name: string; crewstation: { layer: number }; dependencies: Record<string, string> };
    expect(pkg.name).toBe('@crewstation/module-order-billing');
    expect(pkg.crewstation.layer).toBe(3);
    expect(Object.keys(pkg.dependencies)).toEqual(['@crewstation/contracts', '@crewstation/kernel', '@crewstation/module-project', 'drizzle-orm']);
  });
});
