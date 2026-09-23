/** 一个源码文件的行覆盖：行号 → 命中次数。只含被至少一个用例加载过的文件。 */
export type LineHits = ReadonlyMap<number, number>;
export type Coverage = ReadonlyMap<string, LineHits>;

/** 解析 lcov：只用 SF（文件）与 DA（行命中）。路径相对仓库根，与 git 给出的一致。 */
export function parseLcov(text: string): Coverage {
  const coverage = new Map<string, Map<number, number>>();
  let current: Map<number, number> | undefined;
  for (const line of text.split('\n')) {
    if (line.startsWith('SF:')) {
      current = new Map();
      coverage.set(line.slice(3).trim(), current);
    } else if (line.startsWith('DA:') && current) {
      const [lineNo, hits] = line.slice(3).split(',');
      current.set(Number(lineNo), Number(hits));
    } else if (line.startsWith('end_of_record')) {
      current = undefined;
    }
  }
  return coverage;
}

/**
 * 各层作业各出一份 lcov；同一行在多层都被执行到时命中次数相加。
 * Bun 对加载了却没调用过的函数把整段（连注释与右括号）记成 0 次，调用过的那层只记真正的语句行：
 * 一行在某层记 0 次、另一层加载了同一文件却没记它，它就不是可执行行，合并时去掉。
 */
export function mergeCoverage(parts: readonly Coverage[]): Coverage {
  const merged = new Map<string, Map<number, number>>();
  const tiersOf = new Map<string, LineHits[]>();
  for (const part of parts) {
    for (const [file, hits] of part) {
      const lines = merged.get(file) ?? new Map<number, number>();
      for (const [line, count] of hits) lines.set(line, (lines.get(line) ?? 0) + count);
      merged.set(file, lines);
      tiersOf.set(file, [...(tiersOf.get(file) ?? []), hits]);
    }
  }
  for (const [file, lines] of merged) {
    const tiers = tiersOf.get(file) ?? [];
    for (const [line, count] of lines) if (count === 0 && tiers.some((hits) => !hits.has(line))) lines.delete(line);
  }
  return merged;
}

export interface AreaCoverage {
  readonly area: string;
  readonly files: number;
  readonly lines: number;
  readonly covered: number;
}

/** 按区域汇总行覆盖率，只统计 `include` 认可的生产代码。 */
export function summarizeCoverage(coverage: Coverage, areaOf: (file: string) => string, include: (file: string) => boolean): AreaCoverage[] {
  const areas = new Map<string, { files: number; lines: number; covered: number }>();
  for (const [file, hits] of coverage) {
    if (!include(file)) continue;
    const area = areas.get(areaOf(file)) ?? { files: 0, lines: 0, covered: 0 };
    area.files += 1;
    area.lines += hits.size;
    area.covered += [...hits.values()].filter((count) => count > 0).length;
    areas.set(areaOf(file), area);
  }
  return [...areas].map(([area, totals]) => ({ area, ...totals })).sort((a, b) => a.area.localeCompare(b.area));
}
