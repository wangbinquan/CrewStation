// ← agent-workflow `packages/shared/src/intentSecretSlots.ts` 的 maskDiagnosticsText 与
//   `packages/backend/src/util/spawnDiagnostics.ts` 的 outputTail：冒烟失败时把厂商原文随原因一起给管理员，
//   给之前先按凭据形状打码、把已知凭据值替换掉，再压成一行尾部（错误总在最后）。
// 与源的差异：打码标记用本仓 Runner 的 `***`（runtimes/task 的 redactSecrets），已知值替换合并进同一个函数；
// 源的 `api-?key` 漏掉查询串里最常见的下划线写法 `api_key`，这里放宽为 `api[-_]?key`。

const MASK = '***';
const ANSI_ESCAPES = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'g');

/** 按凭据形状打码：URL 里的 userinfo、查询串里的令牌类参数、命令行里的令牌类选项；再替换已知凭据值。 */
export function maskDiagnosticsText(text: string, knownSecrets: readonly string[] = []): string {
  let out = text
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi, `$1${MASK}@`)
    .replace(/([?&](?:token|secret|password|api[-_]?key|access_token|private_token|auth)=)[^&\s]+/gi, `$1${MASK}`)
    .replace(/((?:^|\s)--?(?:token|secret|password|passwd|api[-_]?key|auth)[=\s])\S+/gi, `$1${MASK}`);
  for (const value of [...knownSecrets].filter((v) => v.length > 0).sort((a, b) => b.length - a.length)) out = out.split(value).join(MASK);
  return out;
}

/** 压成一行并只留尾部 cap 个字符：去掉 ANSI 转义、合并空白。 */
export function outputTail(text: string, cap = 300): string {
  const collapsed = text.replace(ANSI_ESCAPES, '').replace(/\s+/g, ' ').trim();
  return collapsed.length <= cap ? collapsed : `…${collapsed.slice(-cap)}`;
}
