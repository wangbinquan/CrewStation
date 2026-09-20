import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * 渲染用例为了少写一份文案，把 en-US 也映射到中文文案（renderApp／renderElement），
 * 所以英文文案漏了键、多了键，没有任何用例会红——用户切到英文才看见一串键名。
 * 这里逐对比较 zh-CN 与 en-US 的键集合，并顺带让英文文案被至少一个用例加载。
 */
const SRC = resolve(import.meta.dir, '..');

function catalogDirs(): string[] {
  const features = join(SRC, 'features');
  return [join(SRC, 'app', 'i18n'), ...readdirSync(features).map((feature) => join(features, feature, 'i18n')).filter((dir) => existsSync(dir))];
}

function flatKeys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => flatKeys(child, prefix ? `${prefix}.${key}` : key));
}

async function messagesOf(path: string): Promise<unknown> {
  const loaded = (await import(path)) as { messages?: unknown };
  if (typeof loaded.messages !== 'object' || loaded.messages === null) throw new Error(`${relative(SRC, path)} 必须导出 messages 对象`);
  return loaded.messages;
}

const pairs = catalogDirs().map((dir) => ({ name: relative(SRC, dir), zh: join(dir, 'zh-CN.ts'), en: join(dir, 'en-US.ts') }));

describe('中英文文案的键一一对应', () => {
  test('每个有文案的目录都同时提供 zh-CN 与 en-US', () => {
    expect(pairs.length).toBeGreaterThan(5);
    expect(pairs.filter((pair) => !existsSync(pair.zh) || !existsSync(pair.en)).map((pair) => pair.name)).toEqual([]);
  });

  test.each(pairs.map((pair) => [pair.name, pair] as const))('%s', async (_name, pair) => {
    const zh = new Set(flatKeys(await messagesOf(pair.zh)));
    const en = new Set(flatKeys(await messagesOf(pair.en)));
    expect(zh.size).toBeGreaterThan(0);
    expect({ 英文缺少: [...zh].filter((key) => !en.has(key)), 中文缺少: [...en].filter((key) => !zh.has(key)) }).toEqual({ 英文缺少: [], 中文缺少: [] });
  });
});
