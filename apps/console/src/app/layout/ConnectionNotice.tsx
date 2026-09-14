import { useSyncExternalStore } from 'react';
import { onlineManager } from '@tanstack/react-query';
import { useT } from '../../shared/lib/useT';
import { ActionNote } from '../../shared/ui/ActionNote';

const subscribe = (listener: () => void) => onlineManager.subscribe(listener);
const isOnline = () => onlineManager.isOnline();

/** 与请求队列使用同一在线状态；提示状态变化，不重挂载页面或抢占输入焦点。 */
export function ConnectionNotice() {
  const online = useSyncExternalStore(subscribe, isOnline, isOnline), t = useT();
  return online ? null : <ActionNote tone="error">{t('ui.connection.offline')}</ActionNote>;
}
