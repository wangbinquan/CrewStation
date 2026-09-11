export const MAX_BACKOFF_SECONDS = 300;

/** 第 attempts 次失败后的等待秒数：min(300, 5·2^attempts) 乘 0.75–1.25 的抖动；与 packages/queue 重排任务用的公式一致。 */
export function backoffSeconds(attempts: number, random: () => number = Math.random): number {
  return Math.min(MAX_BACKOFF_SECONDS, 5 * 2 ** attempts) * (0.75 + random() / 2);
}
