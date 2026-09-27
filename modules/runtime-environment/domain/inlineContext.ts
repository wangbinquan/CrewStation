import type { ImageRevision } from './records';
import { validation } from '@crewstation/kernel';
import { shellArg } from './buildScripts';

/** 文件内容经只读挂载传递，不拼进 shell 或 kubelet 的 argv。 */
export function inlineContextScript(revision: ImageRevision): string {
  if (revision.source.kind !== 'inline') throw validation('需要直接编写配方');
  const lines = ['set -eu', 'mkdir -p /workspace/context', 'cat /context-input/dockerfile > /workspace/context/Dockerfile'];
  for (const [index, file] of revision.source.files.entries()) {
    const encoded = Buffer.from(file.path).toString('base64');
    lines.push(`path=/workspace/context/$(printf '%s' ${shellArg(encoded)} | base64 -d)`, 'mkdir -p "$(dirname "$path")"', `base64 -d < /context-input/file-${index} > "$path"`, `chmod ${file.executable ? '755' : '644'} "$path"`);
  }
  return `${lines.join('\n')}\n`;
}
