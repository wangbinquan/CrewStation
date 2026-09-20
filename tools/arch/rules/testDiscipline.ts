import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { EXTRA_TEST_ROOTS, ROOT_TEST_LOOSE_FILES, ROOT_TEST_TIERS } from '../policy';
import { isTestPath, readText, walk } from '../sourceFiles';
import type { Violation, Workspace } from '../archModel';

const RULE = 'test-discipline';
const SUBJECT = String.raw`\b(?:test|it|describe)(?:\.\w+)*`;

/** 每一条都是「让防护悄悄失效」的写法；判定只看去掉注释后的代码。 */
const BANNED: ReadonlyArray<{ pattern: RegExp; message: string }> = [
  { pattern: new RegExp(String.raw`${SUBJECT}\.only\b`), message: '禁止提交 .only：同文件其余用例被静默跳过，本机不报错' },
  { pattern: new RegExp(String.raw`${SUBJECT}\.skip\s*\(`), message: '禁止无条件 .skip：环境缺席用 skipIf 加能力闸门，过时的用例直接删' },
  { pattern: new RegExp(String.raw`${SUBJECT}\.todo\b`), message: '禁止 .todo：没写出来的用例不是防护' },
  { pattern: new RegExp(String.raw`${SUBJECT}\.failing\b`), message: '禁止 .failing：已知失败要么修要么删' },
  { pattern: /\bskipIf\s*\(\s*(?:true|1|!0|!!1)\s*\)/, message: '禁止恒真的 skipIf：条件必须来自一次真实的环境探测' },
  { pattern: /\bretry\s*:\s*[1-9]/, message: '禁止用例重试（retry: N）：重跑才过不算通过，先查清是不是真 bug；若这是被测对象自己的 retry 字段，把取值提成具名常量' },
];

/** bun 自己还认这些命名；CI 按层拆作业时只认 `.test.ts(x)`，别的命名会在本机照跑、在 CI 上不属于任何一层。 */
const FOREIGN_TEST_NAME = /(?:\.spec\.(?:ts|tsx|js|jsx|mjs|cjs)|_(?:test|spec)\.(?:ts|tsx|js|jsx|mjs|cjs)|\.test\.(?:js|jsx|mjs|cjs))$/;

/** 用例纪律：禁用会让防护静默失效的写法；用例文件统一命名；仓库根 tests/ 只允许约定的用例层目录。 */
export function testDiscipline(ws: Workspace): Violation[] {
  const out: Violation[] = [];
  for (const path of testFiles(ws)) {
    const code = stripComments(readText(path));
    for (const banned of BANNED) {
      if (banned.pattern.test(code)) out.push({ rule: RULE, file: path, message: banned.message });
    }
  }
  out.push(...foreignTestNames(ws), ...rootTestTiers(ws.root));
  return out;
}

function foreignTestNames(ws: Workspace): Violation[] {
  const out: Violation[] = [];
  const dirs = [...ws.units.map((unit) => unit.dir), ...EXTRA_TEST_ROOTS.map((top) => join(ws.root, top)).filter((dir) => existsSync(dir))];
  for (const dir of dirs) {
    walk(dir, (path) => {
      if (FOREIGN_TEST_NAME.test(path)) out.push({ rule: RULE, file: path, message: '用例文件只用 .test.ts／.test.tsx 命名：别的命名本机照跑，CI 按层拆作业时却认不出来，等于从不在 CI 上执行' });
    });
  }
  return out;
}

function testFiles(ws: Workspace): string[] {
  const paths = ws.files.filter((file) => file.isTest).map((file) => file.path);
  for (const top of EXTRA_TEST_ROOTS) {
    const dir = join(ws.root, top);
    if (!existsSync(dir)) continue;
    walk(dir, (path) => {
      if (/\.(ts|tsx)$/.test(path) && !path.endsWith('.d.ts') && (top === 'tests' || isTestPath(relative(ws.root, path)))) paths.push(path);
    });
  }
  return paths;
}

function rootTestTiers(root: string): Violation[] {
  const dir = join(root, 'tests');
  if (!existsSync(dir)) return [];
  const out: Violation[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (!ROOT_TEST_TIERS.includes(entry)) out.push({ rule: RULE, file: path, message: `仓库根 tests/ 只允许用例层目录 ${ROOT_TEST_TIERS.join('、')}；单元自己的用例放回单元里` });
    } else if (!ROOT_TEST_LOOSE_FILES.includes(entry) && !entry.startsWith('.')) {
      out.push({ rule: RULE, file: path, message: '仓库根 tests/ 不散放文件；放进所属用例层的目录' });
    }
  }
  return out;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
}
