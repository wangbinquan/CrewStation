import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ScriptStep } from '@crewstation/contracts';
import { BEFORE_START_LIMITS, HOOK_CONTEXT_ENV } from '@crewstation/contracts';
import type { ProcessLauncher } from '../process/launcher';
import { killProcessTree } from '../process/processTree';
import { pumpStream } from '../process/streamPump';
import { readEnvOutput } from './envOutput';
import { BeforeStartFailure } from './failure';
import { resolveHookPath } from './hookPaths';
import type { InterpreterCatalog } from './interpreters';
import type { HookContext } from './templateContext';
import { redactSecrets } from './templateContext';

export interface ScriptStepDeps { launcher: ProcessLauncher; interpreters: InterpreterCatalog; signal: AbortSignal }
export interface ScriptStepResult { exitCode: number | null; cwd: string; output: Record<string, string>; log: { stdoutTail: string; stderrTail: string } }

/**
 * 执行脚本：源码写进运行目录（0600、worker 属主），以 Agent 同一身份在独立进程组中运行；
 * 超时或取消杀整棵进程组；退出 0 且环境输出合法才把变量交给后续步骤与 CLI。
 */
export async function executeScriptStep(step: ScriptStep, ctx: HookContext, deps: ScriptStepDeps): Promise<ScriptStepResult> {
  const cwd = step.cwdTemplate ? resolveHookPath(step.cwdTemplate, ctx, step.stepId) : ctx.workspace;
  const scriptFile = join(ctx.runDir, `hook-${step.stepId}.${deps.interpreters.extensionFor(step)}`);
  const envOut = join(ctx.runDir, `hook-${step.stepId}.env.json`);
  await writeFile(scriptFile, step.source, { mode: 0o600 });
  await deps.launcher.chownToWorker(scriptFile);
  // 脚本源码不做凭据文本替换：凭据经输入环境读取（RFC-004 §5.1）。
  const env = deps.launcher.baseEnv({
    ...ctx.vars, ...ctx.secrets, ...ctx.env, HOME: ctx.home,
    [HOOK_CONTEXT_ENV.agentId]: ctx.agentId, [HOOK_CONTEXT_ENV.agentHome]: ctx.home, [HOOK_CONTEXT_ENV.agentRunDir]: ctx.runDir, [HOOK_CONTEXT_ENV.workdir]: ctx.workspace, [HOOK_CONTEXT_ENV.envOut]: envOut,
  });
  const cmd = deps.interpreters.argvFor(step, scriptFile, cwd, env);
  if (deps.signal.aborted) throw new BeforeStartFailure('cancelled', '启动前脚本在开始前被取消', step.stepId);
  let proc;
  try { proc = deps.launcher.spawnPiped({ cmd, cwd, env }); }
  catch (error) { throw new BeforeStartFailure('unknown_interpreter', `无法启动解释器：${error instanceof Error ? error.message : String(error)}`, step.stepId); }
  let timedOut = false, cancelled = false;
  const timer = setTimeout(() => { timedOut = true; void killProcessTree(proc); }, step.timeoutMs);
  const onAbort = () => { cancelled = true; void killProcessTree(proc); };
  deps.signal.addEventListener('abort', onAbort, { once: true });
  const tails = { stdout: '', stderr: '' };
  const collect = (key: 'stdout' | 'stderr') => (text: string) => { tails[key] = (tails[key] + text).slice(-BEFORE_START_LIMITS.maxLogTailChars); };
  try {
    await proc.exited;
    await Promise.race([Promise.all([pumpStream(proc.stdout, collect('stdout')), pumpStream(proc.stderr, collect('stderr'))]), Bun.sleep(2000)]);
  } finally {
    clearTimeout(timer);
    deps.signal.removeEventListener('abort', onAbort);
  }
  const log = { stdoutTail: redactSecrets(tails.stdout, ctx.secrets), stderrTail: redactSecrets(tails.stderr, ctx.secrets) };
  if (cancelled) throw new BeforeStartFailure('cancelled', '启动前脚本被取消', step.stepId);
  if (timedOut) throw new BeforeStartFailure('script_timeout', `脚本超过 ${Math.round(step.timeoutMs / 1000)} 秒未结束，已终止整个进程组`, step.stepId);
  const exitCode = proc.exitCode;
  if (exitCode !== 0) throw Object.assign(new BeforeStartFailure('script_failed', `脚本退出码 ${exitCode ?? 'null'}${proc.signalCode ? `（信号 ${proc.signalCode}）` : ''}`, step.stepId), { exitCode, log });
  return { exitCode, cwd, output: await readEnvOutput(envOut, step.stepId), log };
}
