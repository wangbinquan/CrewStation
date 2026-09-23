import type { NativeTerminalDto } from '@crewstation/contracts';
import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { NativeTerminalAttachment } from '../../model/native/nativeTerminalAttachment';
import type { NativeTerminalSurface } from '../../model/native/nativeTerminalSurface';
import { creatorClaims } from '../../model/native/creatorClaims';

/** 焦点在别的可编辑处（输入框、编辑器、另一个终端）时不抢焦点。 */
export function busyElsewhere(host: HTMLElement | null): boolean {
  const current = document.activeElement as HTMLElement | null;
  if (!current || current === document.body || host?.contains(current)) return false;
  return current.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(current.tagName);
}

/**
 * RFC-022 D1：本窗口创建的 CLI，终端一接上就替创建者取得输入控制。新 Runner 在启动中就接受，CLI 第一次查询终端时已有窗口回答，
 * 一拉起就显示界面；旧 Runner 在启动中拒绝时不报错，进程拉起后再取。拉起后取得成功即作废登记（只做一次），
 * 焦点不在别的可编辑处就把焦点移进终端；之后按既有规则：焦点在终端才保持，离开 30 秒释放。
 */
export function useCreatorClaim(options: {
  readonly terminal: NativeTerminalDto; readonly attachment: NativeTerminalAttachment; readonly surface: NativeTerminalSurface;
  readonly host: RefObject<HTMLDivElement | null>; readonly phase: string; readonly canDevelop: boolean;
}): boolean {
  const { terminal, attachment, surface, host, phase, canDevelop } = options;
  const created = canDevelop && creatorClaims.has(terminal.clientRequestId);
  const starting = terminal.lifecycle === 'starting', running = terminal.lifecycle === 'running';
  const early = useRef(false);
  useEffect(() => {
    if (!created || phase !== 'ready' || (!starting && !running) || (starting && early.current)) return undefined;
    if (starting) early.current = true;
    let cancelled = false;
    void attachment.ensureControl({ quiet: true }).then((ok) => {
      if (cancelled || !ok || !running) return;
      creatorClaims.consume(terminal.clientRequestId);
      surface.setControlled(true);
      if (!busyElsewhere(host.current)) surface.focus();
    });
    return () => { cancelled = true; };
  }, [created, phase, starting, running, attachment, surface, host, terminal.clientRequestId]);
  // 启动期间把创建者的窗口当作「在用」：焦点不在终端也续约，控制不会在进程拉起前被 30 秒释放掉。
  return created && starting;
}
