import type { RuntimeImageToolCheck } from '@crewstation/contracts';
import type { ProcessLauncher } from '../process/launcher';
import { signalTree } from '../process/processTree';
import { pumpStream } from '../process/streamPump';

export async function runInitializationCommand(launcher: ProcessLauncher, input: { argv: string[]; cwd: string; env: Record<string, string>; timeoutSeconds: number }, signal: AbortSignal) {
  signal.throwIfAborted();
  const process = launcher.spawnPiped({ cmd: input.argv, cwd: input.cwd, env: launcher.baseEnv(input.env) });
  let timedOut = false, exceeded = false, output = '', bytes = 0;
  const kill = () => signalTree(process, 'SIGKILL');
  signal.addEventListener('abort', kill, { once: true });
  if (signal.aborted) kill();
  const timer = setTimeout(() => { timedOut = true; kill(); }, input.timeoutSeconds * 1000);
  const collect = (text: string) => { bytes += Buffer.byteLength(text); if (bytes > 262144) { exceeded = true; kill(); } else if (!exceeded) output += text; };
  const pumping = Promise.all([pumpStream(process.stdout, collect), pumpStream(process.stderr, collect)]);
  try {
    await process.exited;
    // 初始化不允许在后台遗留程序；即便主进程成功，也终止它的整个进程组。
    kill();
    const drained = await Promise.race([pumping.then(() => true), Bun.sleep(2000).then(() => false)]);
    return { exitCode: process.exitCode, output: exceeded ? '[输出超过初始化上限]' : output, failed: timedOut || exceeded || !drained || signal.aborted || process.exitCode !== 0 };
  } finally { clearTimeout(timer); signal.removeEventListener('abort', kill); }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}
export function toolMatches(output: string, expected: RuntimeImageToolCheck['expected']): boolean {
  const text = output.trim();
  if (expected.kind === 'text') return text === expected.value;
  if (expected.kind === 'sha256') return new Bun.CryptoHasher('sha256').update(text).digest('hex') === expected.value;
  try { return JSON.stringify(canonical(JSON.parse(text))) === JSON.stringify(canonical(expected.value)); } catch { return false; }
}

export function redactInitializationOutput(output: string, secrets: Record<string, string>): string {
  const patterns = Object.values(secrets).filter(Boolean).flatMap((s) => [s, Buffer.from(s).toString('base64'), encodeURIComponent(s), JSON.stringify(s).slice(1, -1)]).sort((a, b) => b.length - a.length);
  let result = output;
  for (const value of patterns) result = result.replaceAll(value, '[REDACTED]');
  return result.slice(0, 8192);
}
