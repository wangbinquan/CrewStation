import type { ReactElement } from 'react';
import { projectRoute } from '../../../app/router/projectRoute';
import { useT } from '../../../shared/lib/useT';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { ConfigEnvPanel } from '../components/ConfigEnvPanel';
import styles from './ConfigPage.module.css';

/** 配置与密钥：两组取值并列，各自独立读写；生产组的写权限由服务端判定。 */
export function ConfigPage(): ReactElement {
  const t = useT();
  const { projectId } = projectRoute.useParams();
  return (
    <>
      <PageHeader title={t('config.title')} description={[t('config.line1'), t('config.line2'), t('config.line3')]} />
      <div className={styles.columns}>
        <ConfigEnvPanel projectId={projectId} env="development" />
        <ConfigEnvPanel projectId={projectId} env="production" />
      </div>
    </>
  );
}
