import { expect, test } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { consoleSources } from './sourceScan';

const SRC = resolve(import.meta.dir, '..');

/** 与 app/i18n/messageCatalog.ts 同一套来源：app 的文案加每个 feature 的 i18n/zh-CN.ts（子文案表由它们展开）。 */
async function catalogKeys(): Promise<ReadonlySet<string>> {
  const features = join(SRC, 'features');
  const files = [join(SRC, 'app', 'i18n', 'zh-CN.ts'), ...readdirSync(features).map((feature) => join(features, feature, 'i18n', 'zh-CN.ts')).filter((file) => existsSync(file))];
  const keys = new Set<string>();
  for (const file of files) for (const key of Object.keys(((await import(file)) as { messages: Record<string, string> }).messages)) keys.add(key);
  return keys;
}

/** `t(` 的第一个参数（允许一层括号，覆盖三元表达式）；其中形如 `a.b.c` 的字符串字面量就是写死的文案键。 */
const FIRST_ARGUMENT = /\bt\(\s*((?:[^(),]|\([^()]*\))+)/g;
const KEY_LITERAL = /'([a-z][\w-]*(?:\.[\w-]+)+)'|"([a-z][\w-]*(?:\.[\w-]+)+)"/g;

// 2026-09-23 实撞：RFC-020 把「打开正式应用／打开试用」挪到 slot.open.* 并删了旧键，项目列表的 SummaryFacts 还在用
// projects.summary.openProduction／openPreview，页面上直接显示键名；中英文键集合一致，所以 i18nParity 看不出来。
test('代码里 t(...) 写死的文案键都在文案表里', async () => {
  const keys = await catalogKeys(), missing: string[] = [];
  for (const file of consoleSources()) {
    for (const call of file.code.matchAll(FIRST_ARGUMENT)) {
      for (const literal of (call[1] ?? '').matchAll(KEY_LITERAL)) {
        const key = literal[1] ?? literal[2] ?? '';
        if (!keys.has(key)) missing.push(`${file.path}: ${key}`);
      }
    }
  }
  expect(missing).toEqual([]);
});
