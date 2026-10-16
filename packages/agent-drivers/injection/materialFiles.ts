import { createHash } from 'node:crypto';
import { chmod, mkdir, open, rename, symlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { BusinessMaterialDownloadsSchema, BusinessPluginFileSchema, BUSINESS_NATIVE_MATERIAL_LIMITS, materialTreeIssue } from '@crewstation/contracts';
import type { BusinessMaterialDownload, BusinessPluginFile } from '@crewstation/contracts';
import { precondition, validation } from '@crewstation/kernel';
import type { ProcessHost } from '../contract/processHost';

/** The caller owns a freshly allocated private root. Never follow a business link during file writes. */
export async function materializeBusinessFiles(root: string, files: readonly BusinessPluginFile[], downloads: readonly BusinessMaterialDownload[], host: ProcessHost, signal?: AbortSignal): Promise<void> {
  const parsed = files.map((file) => BusinessPluginFileSchema.parse(file)), issue = materialTreeIssue(parsed);
  if (issue || parsed.length > BUSINESS_NATIVE_MATERIAL_LIMITS.files) throw validation('材料文件树无效', { code: 'invalid_configuration', reason: issue });
  const grants = BusinessMaterialDownloadsSchema.parse(downloads), byId = new Map(grants.map((g) => [g.object.objectId, g]));
  let bytes = 0;
  for (const file of parsed) if (file.kind === 'file') {
    bytes += file.object?.size ?? Buffer.byteLength(file.content ?? '');
    if (file.object) {
      const grant = byId.get(file.object.objectId);
      if (!grant || grant.object.sha256 !== file.object.sha256 || grant.object.size !== file.object.size || Date.parse(grant.expiresAt) <= Date.now()) throw precondition('材料下载授权缺失、过期或元数据不一致', { code: 'material_download_unavailable' });
    }
  }
  if (bytes > BUSINESS_NATIVE_MATERIAL_LIMITS.bytes) throw validation('材料文件超过字节预算', { code: 'invalid_configuration' });
  const dirs = new Set<string>([root]);
  for (const file of parsed) {
    let at = dirname(join(root, file.path));
    while (at !== root) { dirs.add(at); at = dirname(at); }
  }
  for (const dir of [...dirs].sort((a, b) => a.length - b.length)) await mkdir(dir, { mode: 0o700 });
  for (const [index, file] of parsed.entries()) if (file.kind === 'file') {
    signal?.throwIfAborted();
    const path = join(root, file.path), temporary = join(root, `.cs-file-${index}-${crypto.randomUUID()}`), output = await open(temporary, 'wx', 0o600);
    try {
      if (file.object) await copyObject(byId.get(file.object.objectId)!, output, signal);
      else await output.writeFile(file.content!);
      await output.sync();
    } finally { await output.close(); }
    await chmod(temporary, file.mode ?? 0o600); await rename(temporary, path); await host.chownToWorker(path);
  }
  // Every target was checked before the first write. Links are the final mutation of the file tree.
  for (const file of parsed) if (file.kind === 'symlink') { signal?.throwIfAborted(); await symlink(file.target, join(root, file.path)); }
  for (const dir of [...dirs].sort((a, b) => b.length - a.length)) await host.chownToWorker(dir);
}
async function copyObject(grant: BusinessMaterialDownload, output: Awaited<ReturnType<typeof open>>, signal?: AbortSignal): Promise<void> {
  const idle = new AbortController(), signals = [idle.signal, AbortSignal.timeout(30 * 60_000), ...(signal ? [signal] : [])];
  let timer = setTimeout(() => idle.abort(), 30_000), reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(grant.url, { headers: { authorization: `Bearer ${grant.token}` }, redirect: 'error', signal: AbortSignal.any(signals) });
    if (!response.ok || !response.body || response.headers.has('content-length') && Number(response.headers.get('content-length')) !== grant.object.size) throw new Error('material-download-failed');
    reader = response.body.getReader(); let size = 0; const hash = createHash('sha256');
    while (true) {
      clearTimeout(timer); timer = setTimeout(() => idle.abort(), 60_000);
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > grant.object.size) throw new Error('material-size-mismatch');
      hash.update(chunk.value);
      let offset = 0;
      while (offset < chunk.value.byteLength) { const result = await output.write(chunk.value, offset); if (!result.bytesWritten) throw new Error('material-write-failed'); offset += result.bytesWritten; }
    }
    if (size !== grant.object.size || hash.digest('hex') !== grant.object.sha256) throw new Error('material-digest-mismatch');
  } catch {
    throw precondition('对象材料下载或完整性校验失败', { code: signal?.aborted ? 'material_download_cancelled' : 'material_download_failed' });
  } finally { clearTimeout(timer); if (reader) { await reader.cancel().catch(() => undefined); reader.releaseLock(); } }
}
