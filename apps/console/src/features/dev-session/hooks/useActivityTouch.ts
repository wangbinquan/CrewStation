import { useCallback, useEffect, useRef } from 'react';
import { api } from '../../../shared/api/client';

/** 心跳间隔：空闲提醒看的是 lastActivityAt，每分钟报一次足够，不必每次点击都打一个请求。 */
const TOUCH_INTERVAL_MS = 60_000;

/**
 * 用户在页面上有动作就刷新会话活动时间，避免空闲提醒误触发。
 * 监听挂在 window 上：本 hook 只在开发会话页挂载期间存在，卸载即摘除。
 * 返回的函数也给面板显式调用（发消息、敲终端），这些动作不一定产生冒泡到 window 的事件。
 */
export function useActivityTouch(taskId: string): () => void {
  const lastRef = useRef(0);
  const notify = useCallback(() => {
    const now = Date.now();
    if (now - lastRef.current < TOUCH_INTERVAL_MS) return;
    lastRef.current = now;
    // 心跳失败不打扰用户：真正的会话状态由轮询与流反映。
    void api.devSession.touch(taskId).catch(() => undefined);
  }, [taskId]);

  useEffect(() => {
    const options: AddEventListenerOptions = { passive: true };
    window.addEventListener('pointerdown', notify, options);
    window.addEventListener('keydown', notify, options);
    return () => {
      window.removeEventListener('pointerdown', notify);
      window.removeEventListener('keydown', notify);
    };
  }, [notify]);

  return notify;
}
