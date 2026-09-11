// ← agent-workflow `util/semver.ts`，原样复制（37 行，零依赖）。
// 两个 `--version` 探针与 opencode 的 flag 拼写版本门都用它。

/** 从任意输出里取第一个 "X.Y.Z"。 */
export function extractVersion(text: string): string | null {
  const m = text.match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
}

/** 只比较 major.minor.patch，忽略 prerelease；无法解析时返回 0（「相等」）。 */
export function compareSemver(a: string, b: string): number {
  const pa = parse(a);
  const pb = parse(b);
  if (pa === null || pb === null) return 0;
  for (let i = 0; i < 3; i += 1) {
    const ai = pa[i];
    const bi = pb[i];
    if (ai === undefined || bi === undefined) continue;
    if (ai !== bi) return ai - bi;
  }
  return 0;
}

function parse(v: string): [number, number, number] | null {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  const out: [number, number, number] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return out.some((n) => !Number.isFinite(n)) ? null : out;
}
