import type { ReactElement } from 'react';
import { api } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/queryKeys';
import { useApiQuery } from '../../shared/api/useApi';
import { useT } from '../../shared/lib/useT';
import styles from './TopBar.module.css';

/** 当前用户：身份由网关在用户域注入，工作台只读 /v1/me。 */
export function CurrentUserChip(): ReactElement {
  const t = useT();
  const me = useApiQuery(queryKeys.me(), () => api.me.get());
  const name = me.data?.name ?? (me.isPending ? t('topBar.userLoading') : t('topBar.userUnknown'));
  const title = me.data === undefined ? t('topBar.userHint') : t('topBar.userTitle', { email: me.data.email, role: t(`topBar.role.${me.data.platformRole}`) });
  return (
    <div className={styles.user} title={title}>
      <span className={styles.avatar} aria-hidden="true">
        {name.slice(0, 1).toUpperCase()}
      </span>
      <span className={styles.userName}>{name}</span>
      {me.data && !me.error ? <span className={styles.demo}>{t(`topBar.role.${me.data.platformRole}`)}</span> : null}
      {me.data?.authMethod === 'password' ? <span className={styles.demo}>{t('topBar.localSession')}</span> : null}
      <a className={styles.logout} href="/auth/logout">
        {t('topBar.logout')}
      </a>
    </div>
  );
}
