import { createContext } from 'react';
import type { Locale, Messages } from './i18n';

export interface I18nContextValue {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly setLocale: (locale: Locale) => void;
}

export const I18nContext = createContext<I18nContextValue | undefined>(undefined);
