export interface FileChange {
  readonly file: string;
  /** 本次改动在新版本里新增或改写的行号。 */
  readonly addedLines: readonly number[];
}

export interface RemovedTest {
  readonly file: string;
  readonly title: string;
}

const HUNK_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;
const TEST_TITLE_RE = /\b(?:test|it|describe)(?:\.\w+(?:\([^)]*\))?)*\s*\(\s*(['"`])((?:(?!\1).)+)\1/;

/** 解析 `git diff --unified=0` 的输出：每个文件在新版本里被新增或改写的行。 */
export function parseAddedLines(diff: string): FileChange[] {
  const changes = new Map<string, number[]>();
  let lines: number[] | undefined;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      const file = line.slice(4).trim().replace(/^b\//, '');
      lines = file === '/dev/null' ? undefined : [];
      if (lines) changes.set(file, lines);
      continue;
    }
    const hunk = HUNK_RE.exec(line);
    if (!hunk || !lines) continue;
    const start = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    for (let offset = 0; offset < count; offset += 1) lines.push(start + offset);
  }
  return [...changes].map(([file, addedLines]) => ({ file, addedLines }));
}

/**
 * 本次改动里消失的用例标题：在删除行里出现、却没有在同一文件的新增行里再出现。
 * 改名与删除这里分不清，也不需要分清——两者都值得让人看一眼，所以只报告、不阻断。
 */
export function parseRemovedTests(diff: string): RemovedTest[] {
  const removed = new Map<string, Set<string>>();
  const added = new Map<string, Set<string>>();
  let file = '';
  for (const line of diff.split('\n')) {
    if (line.startsWith('--- ')) {
      const from = line.slice(4).trim().replace(/^a\//, '');
      if (from !== '/dev/null') file = from;
      continue;
    }
    if (line.startsWith('+++ ')) {
      const to = line.slice(4).trim().replace(/^b\//, '');
      if (to !== '/dev/null') file = to;
      continue;
    }
    const bucket = line.startsWith('-') ? removed : line.startsWith('+') ? added : undefined;
    const title = bucket ? TEST_TITLE_RE.exec(line.slice(1))?.[2] : undefined;
    if (!bucket || !title) continue;
    bucket.set(file, (bucket.get(file) ?? new Set()).add(title));
  }
  return [...removed].flatMap(([path, titles]) => [...titles].filter((title) => !added.get(path)?.has(title)).map((title) => ({ file: path, title })));
}
