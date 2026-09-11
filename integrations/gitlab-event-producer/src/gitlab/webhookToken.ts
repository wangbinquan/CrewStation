/**
 * GitLab webhook 密钥校验（Manifest `spec.ingress.verification: gitlab-token`）。
 * GitLab 把 webhook 上配置的 Secret token 原样放在 `X-Gitlab-Token` 请求头里；对不上就不受理，任何解析都不做。
 *
 * 这里先各自取 SHA-256 再定长比较：timingSafeEqual 要求两段等长，直接比原文会因长度不同抛错，
 * 抛错的分支本身就是一次长度泄漏。摘要长度恒为 32 字节，比较时间与输入无关。
 */
import { createHash, timingSafeEqual } from 'node:crypto';

export const GITLAB_TOKEN_HEADER = 'x-gitlab-token';

export type TokenCheck = { ok: true } | { ok: false; reason: string };

/**
 * @param provided 请求头 `X-Gitlab-Token` 的值
 * @param expected 平台按 Manifest `spec.env` 注入的密钥；未配置时一律拒绝，绝不退化成“不校验”
 */
export function verifyWebhookToken(provided: string | null | undefined, expected: string | null | undefined): TokenCheck {
  if (!expected) return { ok: false, reason: '服务未配置 webhook 密钥，拒绝一切请求' };
  if (!provided) return { ok: false, reason: `缺少 ${GITLAB_TOKEN_HEADER} 请求头` };
  if (timingSafeEqual(digest(provided), digest(expected))) return { ok: true };
  return { ok: false, reason: `${GITLAB_TOKEN_HEADER} 与配置的 webhook 密钥不一致` };
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}
