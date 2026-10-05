export type GitLabNativeCommand = (argv: string[], signal: AbortSignal, input?: string) => Promise<string>;

async function bounded(stream: ReadableStream<Uint8Array>, limit: number) {
  const reader = stream.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.length;
      if (bytes > limit) throw Error('native-source-output-budget'); chunks.push(part.value); }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } finally { reader.releaseLock(); }
}

/** Internal host command runner; the HTTP endpoint supplies no commands or scripts. */
export const nativeSourceCommand: GitLabNativeCommand = async (argv, signal, input = '') => {
  signal.throwIfAborted();
  const child = Bun.spawn(argv, { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  const cancel = () => child.kill(); signal.addEventListener('abort', cancel, { once: true });
  try {
    signal.throwIfAborted(); child.stdin.write(input); child.stdin.end();
    const [exit, stdout, stderr] = await Promise.all([child.exited, bounded(child.stdout, 8_388_608), bounded(child.stderr, 8192)]);
    signal.throwIfAborted();
    if (exit !== 0) throw Error(stderr.match(/native-source-[a-z-]+(?::[a-z-]+)?/)?.[0] ?? 'native-source-command-unavailable');
    return stdout;
  } finally { signal.removeEventListener('abort', cancel); if (child.exitCode === null) { child.kill(); await child.exited; } }
};
