// 用法：bun run scaffold:module <name> <layer> [--deps a,b] [--desc "职责"] [--no-persistence]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { renderModuleFiles } from './moduleTemplate';

const root = resolve(import.meta.dir, '..', '..');
const [name, layerArg, ...rest] = process.argv.slice(2);
if (!name || !layerArg || !/^[a-z][a-z0-9-]*$/.test(name)) {
  console.error('用法：bun run scaffold:module <kebab-name> <layer> [--deps a,b] [--desc "..."] [--no-persistence]');
  process.exit(2);
}
const layer = Number(layerArg);
const deps = (valueOf(rest, '--deps') ?? '').split(',').filter(Boolean);
const desc = valueOf(rest, '--desc') ?? '';
const persistence = !rest.includes('--no-persistence');
const dir = join(root, 'modules', name);
if (existsSync(dir)) {
  console.error(`模块已存在：${dir}`);
  process.exit(1);
}
const persistencePkg = JSON.parse(readFileSync(join(root, 'packages', 'persistence', 'package.json'), 'utf8')) as { dependencies?: Record<string, string> };
const drizzleVersion = persistencePkg.dependencies?.['drizzle-orm'];
if (persistence && !drizzleVersion) {
  console.error('packages/persistence 未声明 drizzle-orm 版本，无法生成持久化模板');
  process.exit(1);
}
for (const [rel, content] of Object.entries(renderModuleFiles({ name, layer, deps, desc, persistence, drizzleVersion: drizzleVersion ?? '' }))) {
  const path = join(dir, rel);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}
console.log(`已生成 modules/${name}（L${layer}${deps.length ? `，依赖 ${deps.join('、')}` : ''}）`);

function valueOf(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}
