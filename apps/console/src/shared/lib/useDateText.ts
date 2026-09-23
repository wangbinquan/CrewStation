import { useCallback } from 'react';
import { formatDateTime } from './dateFormat';
import { useI18n } from './useI18n';

/** 按当前界面语言格式化时间戳；页面里到处要用，包一层省得每处都取 locale，缺值统一显示 `—`。默认到分钟。 */
export function useDateText(precision: 'minute' | 'second' = 'minute'): (value: string | undefined) => string {
  const { locale } = useI18n();
  return useCallback((value: string | undefined) => (value === undefined ? '—' : formatDateTime(value, locale, precision)), [locale, precision]);
}
