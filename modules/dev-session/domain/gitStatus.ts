/** 解析 `git status --porcelain` 与 `git log --branches --not --remotes --oneline` 的输出。 */
export function uncommittedPaths(porcelain: string): string[] {
  return porcelain.split('\n').map((l) => l.trimEnd()).filter(Boolean).map((l) => l.slice(3).trim());
}

export function unpushedCommits(oneline: string): string[] {
  return oneline.split('\n').map((l) => l.trim()).filter(Boolean);
}
