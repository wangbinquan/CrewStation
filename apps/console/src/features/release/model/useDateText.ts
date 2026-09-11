import { useCallback } from 'react';
import { formatDateTime } from '../../../shared/lib/dateFormat';
import { useI18n } from '../../../shared/lib/useI18n';

/** 按当前界面语言格式化时间戳；发布、切流与标签三张表都要用。 */
export function useDateText(): (value: string | undefined) => string {
  const { locale } = useI18n();
  return useCallback((value: string | undefined) => (value === undefined ? '—' : formatDateTime(value, locale)), [locale]);
}
