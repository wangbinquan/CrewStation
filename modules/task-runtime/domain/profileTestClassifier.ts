import type { ProfileTestOutcome } from '@crewstation/contracts';

/*
 * 失败分类移植自 agent-workflow packages/backend/src/services/runtimeSmoke.ts（RFC-006 §6.2）：
 * 正则与判定顺序保持一致——超时 → 网络 → 鉴权 → 模型 → 不符合协议。改动这里要同步移植那边的回归用例。
 */

const AUTH_SIGNATURES = /not logged in|unauthorized|authentication|invalid api key|please run .*login|no api key|anthropic_api_key|log ?in to/i;

/**
 * 裸的 503／529 必须带 HTTP 语境：测试提示里的 nonce 是十六进制串，凑巧含这三连数字的概率不低，
 * 无边界匹配会把「不符合协议」误判成「模型调用失败」（agent-workflow 实测 20 万次随机 nonce 误命中 1327 次）。
 */
const HTTP_STATUS_CTX = String.raw`(?:\bhttp[/ ]?[\d.]*\s*|"?\bstatus(?:_?code)?"?\s*[:=]\s*|\berror\s*[:=]\s*|\bcode\s*[:=]\s*)`;

export const MODEL_FAIL_SIGNATURES = new RegExp([
  'rate limit',
  'overloaded',
  'quota',
  'model .*not found',
  'insufficient',
  'too many requests',
  `${HTTP_STATUS_CTX}(?:503|529)\\b`,
  String.raw`\b(?:503|529)\s+(?:service unavailable|overloaded)`,
  'does not have access to model',
  '(?:暂无|无权).{0,10}模型',
  '模型.{0,12}权限',
].join('|'), 'i');

/**
 * 端点不可达：地区封锁的 403、连接被拒／重置／超时、DNS 失败、无路由、代理隧道失败。先于鉴权判定：
 * claude 的地区封锁文案是 "Failed to authenticate. API Error: 403 Request not allowed"，带着鉴权字样，根因却是网络。
 */
export const NETWORK_SIGNATURES = /403 request not allowed|not available in your (?:region|country|location)|fetch failed|network error|connection (?:error|refused|reset|timed ?out)|econnrefused|econnreset|econnaborted|enetunreach|ehostunreach|enetdown|enotfound|etimedout|eai_again|getaddrinfo|socket hang up|no route to host|network is unreachable|tunneling socket|unable to connect|could not connect|failed to connect/i;

export type ProtocolFailure = Extract<ProfileTestOutcome, 'timeout' | 'network-blocked' | 'auth-missing' | 'model-call-failed' | 'stream-nonconforming'>;

/** 只在没通过时调用：健康的 nonce 回显不会误触鉴权／模型判定。haystack 取错误文案（含 stderr 尾部）与回文。 */
export function classifyProtocolFailure(input: { timedOut: boolean; haystack: string }): ProtocolFailure {
  if (input.timedOut) return 'timeout';
  const text = input.haystack.toLowerCase();
  if (NETWORK_SIGNATURES.test(text)) return 'network-blocked';
  if (AUTH_SIGNATURES.test(text)) return 'auth-missing';
  if (MODEL_FAIL_SIGNATURES.test(text)) return 'model-call-failed';
  return 'stream-nonconforming';
}
