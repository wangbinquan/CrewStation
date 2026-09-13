import type { ChangeEvent, ReactElement } from 'react';
import { isLocale, LOCALES } from '../../shared/lib/i18n';
import { useI18n } from '../../shared/lib/useI18n';
import { useT } from '../../shared/lib/useT';
import styles from './TopBar.module.css';

export function LocaleSwitch(): ReactElement {
  const t = useT();
  const { locale, setLocale } = useI18n();
  const onChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    if (isLocale(event.target.value)) setLocale(event.target.value);
  };
  return (
    <label className={styles.locale}>
      <span className={styles.localeLabel}>{t('locale.label')}</span>
      <select className={styles.localeSelect} aria-label={t('locale.label')} value={locale} onChange={onChange}>
        {LOCALES.map((option) => (
          <option key={option} value={option}>
            {t(`locale.${option}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
