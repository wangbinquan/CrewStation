import { useCallback } from 'react';
import { translate } from './i18n';
import type { MessageValues } from './i18n';
import { useI18n } from './useI18n';

export type Translate = (key: string, values?: MessageValues) => string;

/** 返回按当前语言查找文案的函数：`t('devSession.title')`。 */
export function useT(): Translate {
  const { messages } = useI18n();
  return useCallback<Translate>((key, values) => translate(messages, key, values), [messages]);
}
