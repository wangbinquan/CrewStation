/** 平台唯一合法的发布标签形态（Design §6）；手工打的其他标签不触发发布。 */
const RELEASE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const BUMPS: ReadonlySet<string> = new Set(['major', 'minor', 'patch']);

/** 版本输入既可以是完整标签，也可以是让平台在最新标签上递增的关键字。 */
export function isPublishVersion(value: string): boolean {
  const trimmed = value.trim();
  return RELEASE_TAG.test(trimmed) || BUMPS.has(trimmed);
}

/** 仅供确认页预览；返回标签始终由服务端裁定。用 BigInt 避免大版本号失真。 */
export function candidateReleaseTag(names: readonly string[], value: string): string | undefined {
  const version = value.trim(); if (!isPublishVersion(version)) return undefined;
  if (RELEASE_TAG.test(version)) return version;
  const all = names.filter((name) => RELEASE_TAG.test(name)).map((name) => name.slice(1).split('.').map(BigInt));
  all.sort((a, b) => { for (let i = 0; i < 3; i++) { if (a[i]! !== b[i]!) return a[i]! > b[i]! ? -1 : 1; } return 0; });
  const [major, minor, patch] = all[0] ?? [0n, 0n, 0n];
  return version === 'major' ? `v${major! + 1n}.0.0` : version === 'minor' ? `v${major}.${minor! + 1n}.0` : `v${major}.${minor}.${patch! + 1n}`;
}
