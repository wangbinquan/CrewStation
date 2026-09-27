import type { K8sClient } from '@crewstation/k8s';
import type { BuildPod, BuildSecret } from './buildSnapshot';

/** 只在内存使用原 Secret。不能取得掩码材料时不持久化任何容器输出。 */
function secretPatterns(secret: BuildSecret): readonly string[] {
  const values = new Set<string>();
  const add = (value: string) => {
    if (!value) return;
    values.add(value); values.add(Buffer.from(value).toString('base64')); values.add(encodeURIComponent(value));
    values.add(JSON.stringify(value).slice(1, -1));
  };
  const visit = (value: unknown): void => {
    if (typeof value === 'string') add(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
      visit(child);
      if (key === 'auth' && typeof child === 'string') { const text = Buffer.from(child, 'base64').toString(); add(text); add(text.slice(text.indexOf(':') + 1)); }
    }
  };
  for (const encoded of Object.values(secret.data ?? {})) {
    const value = Buffer.from(encoded, 'base64').toString(); add(value);
    try { visit(JSON.parse(value)); } catch { /* 普通文本 token */ }
  }
  return [...values].sort((a, b) => b.length - a.length);
}
async function boundedLog(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader(), chunks: Uint8Array[] = [];
  let bytes = 0, truncated = false;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 131072) { truncated = true; break; }
      chunks.push(next.value);
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  const text = Buffer.concat(chunks).toString('utf8');
  // 丢弃截断的最后一行，不能把 token 的半段当成可公开日志。
  const complete = text.slice(0, Math.max(0, text.lastIndexOf('\n')));
  return truncated ? `${complete}\n[日志超过单次读取上限]` : complete;
}
const hash = (text: string) => new Bun.CryptoHasher('sha256').update(text).digest('hex');

export async function readImageBuildLogs(k8s: K8sClient, pod: BuildPod, secret: BuildSecret | undefined, previous: string | undefined, signal: AbortSignal) {
  if (!secret?.data) return undefined;
  const patterns = secretPatterns(secret), lines: string[] = [], cursors: Record<string, string> = {};
  let prior: Record<string, string> = {};
  try { const parsed: unknown = JSON.parse(previous ?? '{}'); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) prior = parsed as Record<string, string>; } catch { /* 首次读日志 */ }
  for (const status of [...(pod.status?.initContainerStatuses ?? []), ...(pod.status?.containerStatuses ?? [])]) {
    if (!status.state?.running && !status.state?.terminated) continue;
    try {
      const text = await boundedLog(await k8s.logs(pod.metadata.namespace!, pod.metadata.name, { container: status.name, timestamps: true, tailLines: 1000, signal }));
      const raw = text.split('\n').filter(Boolean), last = raw.at(-1);
      if (!last) continue;
      cursors[status.name] = hash(last);
      const seen = raw.findLastIndex((line) => hash(line) === prior[status.name]);
      for (let line of raw.slice(seen + 1)) {
        for (const secret of patterns) line = line.replaceAll(secret, '[REDACTED]');
        lines.push(`[${status.name}] ${line}`);
      }
    } catch { if (prior[status.name]) cursors[status.name] = prior[status.name]!; }
  }
  return { cursor: JSON.stringify(cursors), lines };
}
