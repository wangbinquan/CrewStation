import { ENTRYPOINT_PATTERNS, EXCEPTION_RULE, PRODUCTION_ROOTS } from './policy';

/** 与 tools/arch 的判定一致：`*.test.ts(x)` 或位于任意 `tests/` 目录之下。 */
export function isTestPath(file: string): boolean {
  return /\.test\.tsx?$/.test(file) || file.split('/').includes('tests');
}

/** 需要用例防护的生产源码：在生产目录之下的 ts／tsx，排除用例、生成代码、类型声明与进程入口。 */
export function isProtectedSource(file: string, scriptEntrypoints: ReadonlySet<string>): boolean {
  if (!/\.tsx?$/.test(file) || file.endsWith('.d.ts')) return false;
  if (!PRODUCTION_ROOTS.includes(file.split('/')[0] ?? '')) return false;
  if (isTestPath(file) || file.split('/').includes('generated')) return false;
  return !scriptEntrypoints.has(file) && !ENTRYPOINT_PATTERNS.some((pattern) => pattern.test(file));
}

/** 根 package.json 的 scripts 里点名的脚本文件（`bun run tools/arch/check.ts`）就是入口，不需要另列清单。 */
export function scriptEntrypoints(rootPackageJson: string): Set<string> {
  const scripts = (JSON.parse(rootPackageJson) as { scripts?: Record<string, string> }).scripts ?? {};
  return new Set(Object.values(scripts).flatMap((command) => [...command.matchAll(/(?:^|\s)((?:[\w.@-]+\/)+[\w.-]+\.tsx?)(?=\s|$)/g)].map((match) => match[1]!)));
}

/**
 * 文件里有没有可执行的逻辑。纯类型文件转译后是空的；只做转发的桶文件（`export … from`）没有可测的东西。
 * 这两类文件不会出现在覆盖率里，不能因此被判成「没有用例防护」。
 */
export function hasRuntimeLogic(file: string, source: string): boolean {
  const output = new Bun.Transpiler({ loader: file.endsWith('x') ? 'tsx' : 'ts' }).transformSync(source);
  const remaining = output
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/[^\n]*$/gm, '')
    .replace(/^\s*export\s*(?:\*|\{[^}]*\})\s*(?:from\s*["'][^"']+["'])?\s*;?\s*$/gm, '')
    .replace(/^\s*import\s[^;\n]*;?\s*$/gm, '');
  return remaining.trim().length > 0;
}

export interface PatchException { readonly pattern: string; readonly until: string }

const EXCEPTION_RE = /^-\s*exception:\s*(\S+)\s+(\S+)\s+until\s+(\d{4}-\d{2}-\d{2})\s*$/;

/** 读取 ADR 里仍在有效期内的 patch-coverage 例外；行格式由 docs/adr/README.md 统一规定。 */
export function activeExceptions(adrTexts: readonly string[], today: string): PatchException[] {
  return adrTexts.flatMap((text) => text.split('\n')).flatMap((line) => {
    const match = EXCEPTION_RE.exec(line.trim());
    return match && match[1] === EXCEPTION_RULE && match[3]! >= today ? [{ pattern: match[2]!, until: match[3]! }] : [];
  });
}

export function isExcepted(file: string, exceptions: readonly PatchException[]): boolean {
  return exceptions.some((exception) => exception.pattern === file || new Bun.Glob(exception.pattern).match(file));
}
