import { useCallback } from 'react';
import { formatDateTime } from '../../../shared/lib/dateFormat';
import { useI18n } from '../../../shared/lib/useI18n';

/** 按当前界面语言格式化时间戳；页面里到处要用，包一层省得每处都取 locale。 */
export function useDateText(): (value: string | undefined) => string {
  const { locale } = useI18n();
  return useCallback((value: string | undefined) => (value === undefined ? '—' : formatDateTime(value, locale)), [locale]);
}
