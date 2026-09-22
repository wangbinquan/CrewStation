import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface ConsoleSource {
  /** 相对 apps/console/src 的路径。 */
  readonly path: string;
  readonly text: string;
  /** 去掉注释后的正文：断言「代码里没有 X」时，不该被解释「为什么没有 X」的注释绊倒。 */
  readonly code: string;
}

const SRC = join(import.meta.dir, '..');
/** 断言本身要写出被禁的词，测试目录必须排除，否则永远红。 */
const SKIP_DIRS = new Set(['tests', 'node_modules']);

function walk(dir: string, match: RegExp): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return SKIP_DIRS.has(entry) ? [] : walk(full, match);
    return match.test(entry) ? [full] : [];
  });
}

function collect(match: RegExp): readonly ConsoleSource[] {
  return walk(SRC, match).map((path) => {
    const text = readFileSync(path, 'utf8');
    return { path: path.slice(SRC.length + 1), text, code: stripComments(text) };
  });
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** 工作台全部源码（不含测试），供源码层断言使用。 */
export function consoleSources(): readonly ConsoleSource[] {
  return collect(/\.tsx?$/);
}

/** 工作台全部样式：断言「某个尺寸只有一个来源」时要看样式本体，而不是用到它的组件。 */
export function consoleStyles(): readonly ConsoleSource[] {
  return collect(/\.css$/);
}

export function sourceAt(files: readonly ConsoleSource[], suffix: string): ConsoleSource {
  const found = files.find((file) => file.path.endsWith(suffix));
  if (found === undefined) throw new Error(`源码里找不到 ${suffix}；文件被改名时这条断言要跟着改，而不是静默通过`);
  return found;
}
