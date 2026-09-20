import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { IDENTITY_HEADERS, PLATFORM_ENV } from '../convention';
import { EVENT_HEADERS } from '../events/delivery';
import { PLATFORM_INTERNAL_HEADERS } from '../gateway/identity';
import { TraceIdSchema } from '../ids';

/**
 * 模板与两个接入容器是独立项目，不 import 任何工作区包，约定表里的名字在它们那边是手抄的字面值。
 * 平台这边改名时它们不会编译失败，也不会让任何平台用例变红——坏的是下一个用模板建出来的项目。
 * 这里扫它们的源码，要求每个 `x-cs-*` 头名与 `CS_*` 环境变量名都出自约定表。
 */
const ROOT = resolve(import.meta.dir, '..', '..', '..');
const MIRROR_ROOTS = ['templates', 'integrations'];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (entry === 'node_modules' || entry === 'dist') return [];
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.ts$/.test(entry) && !/\.test\.ts$/.test(entry) ? [path] : [];
  });
}

/** 去掉注释后取字符串字面值：注释里举例提到别的名字不算数。 */
function literals(path: string, pattern: RegExp): Array<{ file: string; value: string }> {
  const code = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
  return [...code.matchAll(/(['"`])((?:(?!\1).)*)\1/g)].map((match) => match[2] ?? '').filter((value) => pattern.test(value)).map((value) => ({ file: relative(ROOT, path), value }));
}

const files = MIRROR_ROOTS.flatMap((top) => sourceFiles(join(ROOT, top)));

describe('模板与接入容器里手抄的约定名', () => {
  test('扫描确实覆盖到了三个独立项目', () => {
    const projects = new Set(files.map((path) => relative(ROOT, path).split('/').slice(0, 2).join('/')));
    expect([...projects].sort()).toEqual(['integrations/gitlab-event-producer', 'integrations/reference-api-proxy', 'templates/minimal-sample']);
  });

  test('每个 x-cs-* 头名都出自约定表', () => {
    const known = new Set<string>([...Object.values(IDENTITY_HEADERS), ...Object.values(EVENT_HEADERS), ...Object.values(PLATFORM_INTERNAL_HEADERS)]);
    const found = files.flatMap((path) => literals(path, /^x-cs-[a-z][a-z-]*[a-z]$/));
    expect(found.length).toBeGreaterThan(0);
    expect(found.filter((hit) => !known.has(hit.value))).toEqual([]);
  });

  test('每个 CS_* 环境变量名都出自约定表', () => {
    const known = new Set<string>(Object.values(PLATFORM_ENV));
    const found = files.flatMap((path) => literals(path, /^CS_[A-Z][A-Z0-9_]*$/));
    expect(found.length).toBeGreaterThan(0);
    expect(found.filter((hit) => !known.has(hit.value))).toEqual([]);
  });

  // gitlab-event-producer 手抄了一份 traceId 的格式判断；平台放宽或收紧格式时它要跟着改。
  test('接入容器手抄的 traceId 格式与平台一致', () => {
    const identity = readFileSync(join(ROOT, 'integrations/gitlab-event-producer/src/platform/identity.ts'), 'utf8');
    const copied = /\/(\^\[0-9a-f\]\{\d+\}\$)\//.exec(identity)?.[1];
    expect(copied).toBeDefined();
    const valid = 'a'.repeat(32);
    expect(new RegExp(copied!).test(valid)).toBe(TraceIdSchema.safeParse(valid).success);
    expect(new RegExp(copied!).test(`${valid}0`)).toBe(TraceIdSchema.safeParse(`${valid}0`).success);
    expect(new RegExp(copied!).test(valid.toUpperCase())).toBe(TraceIdSchema.safeParse(valid.toUpperCase()).success);
  });
});
