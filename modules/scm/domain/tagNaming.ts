import type { TagBump } from '@crewstation/contracts';
import { RELEASE_TAG_PATTERN } from '@crewstation/contracts';
import { validation } from '@crewstation/kernel';

export interface ReleaseVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

/** 保护标签通配：匹配所有平台发布标签，只有维护者（平台机器人）能创建。 */
export const RELEASE_TAG_PROTECTION_PATTERN = 'v*';

export function parseReleaseTag(name: string): ReleaseVersion | undefined {
  const match = RELEASE_TAG_PATTERN.exec(name);
  if (!match) return undefined;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

export function formatReleaseTag(version: ReleaseVersion): string {
  return `v${version.major}.${version.minor}.${version.patch}`;
}

export function compareReleaseVersions(a: ReleaseVersion, b: ReleaseVersion): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/** 不符合平台格式的标签（手工标签）不参与发布序列。 */
export function latestReleaseTag(names: readonly string[]): string | undefined {
  let best: ReleaseVersion | undefined;
  for (const name of names) {
    const version = parseReleaseTag(name);
    if (version && (!best || compareReleaseVersions(version, best) > 0)) best = version;
  }
  return best ? formatReleaseTag(best) : undefined;
}

const BUMPS: readonly string[] = ['major', 'minor', 'patch'];

export function isTagBump(value: string): value is TagBump {
  return BUMPS.includes(value);
}

/** `bump` 为 major／minor／patch 时在最新标签上递增（无标签从 v0.0.0 起算）；否则视为显式完整标签名并校验格式。 */
export function nextTag(latestTag: string | undefined, bump: TagBump | string): string {
  if (!isTagBump(bump)) {
    if (!parseReleaseTag(bump)) throw validation(`标签 ${bump} 必须形如 v<major>.<minor>.<patch>`, { tag: bump });
    return bump;
  }
  const parsed = latestTag === undefined ? undefined : parseReleaseTag(latestTag);
  if (latestTag !== undefined && !parsed) throw validation(`最新标签 ${latestTag} 不符合 v<major>.<minor>.<patch>`, { tag: latestTag });
  const current = parsed ?? { major: 0, minor: 0, patch: 0 };
  switch (bump) {
    case 'major': return formatReleaseTag({ major: current.major + 1, minor: 0, patch: 0 });
    case 'minor': return formatReleaseTag({ major: current.major, minor: current.minor + 1, patch: 0 });
    case 'patch': return formatReleaseTag({ ...current, patch: current.patch + 1 });
  }
}
