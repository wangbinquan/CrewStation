import type { RunnerEvent } from '@crewstation/contracts';

/** 需要落库供重连回放与追溯的事件；终端与命令的原始输出、输入控制的换人只做实时转发，不落库（Design §5.8）。 */
export function isDurable(event: RunnerEvent): boolean {
  switch (event.kind) {
    case 'nativeActivity': case 'nativeTerminal': case 'agent': case 'beforeStart': case 'execExited': case 'previewState': case 'runnerState': case 'terminalClosed': case 'fileChanged':
      return true;
    case 'terminalOutput': case 'terminalResized': case 'execOutput': case 'terminalControl':
      return false;
  }
}
