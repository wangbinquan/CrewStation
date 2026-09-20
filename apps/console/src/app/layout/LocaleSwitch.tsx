import type { ReactElement } from 'react';
import { LOCALES } from '../../shared/lib/i18n';
import { useI18n } from '../../shared/lib/useI18n';
import { useT } from '../../shared/lib/useT';
import styles from './TopBar.module.css';

export function LocaleSwitch(): ReactElement {
  const t = useT();
  const { locale, setLocale } = useI18n();
  return (
    <div className={styles.locale} role="group" aria-label={t('locale.label')}>
      {LOCALES.map((option) => (
        <button key={option} type="button" className={styles.localeButton} lang={option}
          aria-label={t(`locale.${option}`)} aria-pressed={locale === option} onClick={() => setLocale(option)}>
          {option === 'en-US' ? 'EN' : t(`locale.${option}`)}
        </button>
      ))}
    </div>
  );
}
