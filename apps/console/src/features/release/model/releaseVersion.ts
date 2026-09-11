/** 平台唯一合法的发布标签形态（Design §6）；手工打的其他标签不触发发布。 */
const RELEASE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const BUMPS: ReadonlySet<string> = new Set(['major', 'minor', 'patch']);

/** 版本输入既可以是完整标签，也可以是让平台在最新标签上递增的关键字。 */
export function isPublishVersion(value: string): boolean {
  const trimmed = value.trim();
  return RELEASE_TAG.test(trimmed) || BUMPS.has(trimmed);
}
