import type { RuntimeImageUsage } from '@crewstation/contracts';

export function inlineSource(usage: RuntimeImageUsage = 'task', architecture = 'linux/amd64') {
  return { kind: 'inline', usage, architecture, dockerfileContent: usage === 'service' ? 'FROM alpine:3.22\n# Install packages and copy your service files here.\n' : 'ARG CS_BASE_IMAGE\nFROM ${CS_BASE_IMAGE}\n# Install packages, scripts and binaries here. Keep the inherited Runner entrypoint.\n', files: [], buildArgs: {} };
}

export function inlineRevisionDraft(): string {
  return JSON.stringify({ source: inlineSource(), initializer: { steps: [], env: {}, secrets: [] }, tools: [] }, null, 2);
}

/** 编码分块，避免大文件展开参数超出浏览器调用栈。 */
export async function encodeBuildFile(file: File): Promise<{ path: string; contentBase64: string; executable: boolean }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return { path: file.name, contentBase64: btoa(binary), executable: false };
}

export function buildFileSize(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  try { const decoded = atob(value); return btoa(decoded) === value ? decoded.length : undefined; } catch { return undefined; }
}
