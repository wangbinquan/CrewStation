import type { RunnerInterpreter, ScriptStep } from '@crewstation/contracts';
import type { ProcessLauncher } from '../process/launcher';
import { ensureExecutable } from '../process/launcher';
import { killProcessTree } from '../process/processTree';
import { pumpStream } from '../process/streamPump';
import { BeforeStartFailure } from './failure';

const PRESET: Record<Exclude<ScriptStep['language'], 'custom'>, { binary: string; extension: string; prefix: string[] }> = {
  shell: { binary: 'bash', extension: 'sh', prefix: [] },
  python: { binary: 'python3', extension: 'py', prefix: [] },
  javascript: { binary: 'bun', extension: 'mjs', prefix: ['run'] },
};

export interface InterpreterCatalog {
  readonly list: RunnerInterpreter[];
  /** 脚本文件的扩展名，让解释器按语言处理。 */
  extensionFor(step: ScriptStep): string;
  /** 完整 argv：解释器 → 脚本文件 → 管理员参数；custom 在此确认可执行文件存在。 */
  argvFor(step: ScriptStep, scriptFile: string, cwd: string, env: Record<string, string>): string[];
}

/** 启动时探测一次预设解释器；版本只用于展示，找不到二进制的语言不进 hello 清单。 */
export async function detectInterpreters(launcher: ProcessLauncher, which: (binary: string) => string | null, timeoutMs = 5000): Promise<InterpreterCatalog> {
  const found = await Promise.all((Object.keys(PRESET) as Array<keyof typeof PRESET>).map(async (language): Promise<RunnerInterpreter | undefined> => {
    const command = which(PRESET[language].binary);
    if (!command) return undefined;
    return { language, command, version: await probeVersion(launcher, command, timeoutMs) };
  }));
  const list = found.filter((i): i is RunnerInterpreter => i !== undefined);
  return {
    list,
    extensionFor: (step) => (step.language === 'custom' ? 'script' : PRESET[step.language].extension),
    argvFor: (step, scriptFile, cwd, env) => {
      if (step.language === 'custom') {
        const head = step.interpreter ?? [];
        try { ensureExecutable(head, cwd, env); } catch { throw new BeforeStartFailure('unknown_interpreter', `自定义解释器 ${head[0] ?? ''} 不存在或不可执行`, step.stepId); }
        return [...head, scriptFile, ...step.argv];
      }
      const preset = PRESET[step.language];
      const available = list.find((i) => i.language === step.language);
      if (!available) throw new BeforeStartFailure('unknown_interpreter', `容器内没有 ${preset.binary}，不能执行 ${step.language} 脚本`, step.stepId);
      return [available.command, ...preset.prefix, scriptFile, ...step.argv];
    },
  };
}

async function probeVersion(launcher: ProcessLauncher, command: string, timeoutMs: number): Promise<string | null> {
  try {
    const proc = launcher.spawnPiped({ cmd: [command, '--version'], cwd: '/', env: launcher.baseEnv() });
    const timer = setTimeout(() => void killProcessTree(proc, 0), timeoutMs);
    let text = '';
    await Promise.all([proc.exited, pumpStream(proc.stdout, (t) => { if (text.length < 512) text += t; }), pumpStream(proc.stderr, () => undefined)]);
    clearTimeout(timer);
    return proc.exitCode === 0 ? (text.trim().split('\n')[0] ?? '').slice(0, 120) || null : null;
  } catch {
    return null;
  }
}
