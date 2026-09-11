import { useContext } from 'react';
import { I18nContext } from './i18nContext';
import type { I18nContextValue } from './i18nContext';

/** 当前语言与切换函数；必须在 I18nProvider 内使用。 */
export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n 必须在 I18nProvider 内使用');
  return value;
}
