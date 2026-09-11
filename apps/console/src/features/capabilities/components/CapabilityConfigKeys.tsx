import type { CapabilityDescriptionDto } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { CapabilitySection } from './CapabilitySection';
import { CopyValue } from './CopyValue';
import styles from './CapabilityConfigKeys.module.css';

type ConfigKeys = CapabilityDescriptionDto['config'];

const GROUPS: readonly (keyof ConfigKeys)[] = ['development', 'production'];

/** 两组取值只给键名：Secret 只写不读，能力说明里同样没有值可给。 */
export function CapabilityConfigKeys({ config }: { readonly config: ConfigKeys }): ReactElement {
  const t = useT();
  return (
    <CapabilitySection title={t('capabilities.config.title')} note={t('capabilities.config.note')}>
      <div className={styles.columns}>
        {GROUPS.map((group) => (
          <section key={group}>
            <h3 className={styles.title}>{t(`capabilities.config.${group}`)}</h3>
            {config[group].length === 0 ? (
              <p className={styles.muted}>{t('capabilities.empty')}</p>
            ) : (
              <ul className={styles.list}>
                {config[group].map((key) => (
                  <li key={key}>
                    <CopyValue value={key} label={key} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </CapabilitySection>
  );
}
