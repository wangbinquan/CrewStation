import { useEffect, useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { DEFAULT_LOCALE } from './i18n';
import type { Locale, MessageCatalog } from './i18n';
import { I18nContext } from './i18nContext';
import type { I18nContextValue } from './i18nContext';

export interface I18nProviderProps {
  readonly catalog: MessageCatalog;
  readonly initialLocale?: Locale;
  readonly children: ReactNode;
}

export function I18nProvider({ catalog, initialLocale = DEFAULT_LOCALE, children }: I18nProviderProps): ReactElement {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute('lang');
    root.lang = locale;
    return () => {
      if (previous === null) root.removeAttribute('lang'); else root.lang = previous;
    };
  }, [locale]);
  const value = useMemo<I18nContextValue>(() => ({ locale, messages: catalog[locale], setLocale }), [catalog, locale]);
  return <I18nContext value={value}>{children}</I18nContext>;
}
