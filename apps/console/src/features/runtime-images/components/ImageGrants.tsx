import { api } from '../../../shared/api/client';
import { AUTO_REFRESH, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { DataTable } from '../../../shared/ui/DataTable';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { ButtonLink } from '../../../shared/ui/navigation/ButtonLink';
import styles from './RuntimeImages.module.css';

/** 镜像授权与算力一样在业务资源页维护；此处解释当前有效范围并提供入口。 */
export function ImageGrants({ imageId }: { readonly imageId: string }) {
  const t = useT();
  const query = useApiQuery(['runtime-images', 'grants', imageId], async () => {
    const [grants, projects] = await Promise.all([api.runtimeImages.grants(imageId), api.projects.list()]);
    return { grants, projects: projects.items };
  }, AUTO_REFRESH);
  return <div className={styles.stack}>
    <p>{t('images.grantsHint')}</p><QueryStatus isPending={query.isPending} error={query.error} />
    {query.data ? <><p>{t(query.data.grants.defaultVisible ? 'images.defaultVisible' : 'images.defaultHidden')}</p>
      <DataTable columns={[t('images.business'), t('images.access'), t('images.actions')]}>
        {query.data.projects.map((project) => {
          const grants = query.data!.grants, override = grants.overrides.find((item) => item.projectId === project.id);
          const retained = grants.retainedProjectIds.includes(project.id);
          const allowed = override ? override.allowed : grants.defaultVisible || retained;
          return <tr key={project.id}><td>{project.name}</td><td>{t(allowed ? 'images.accessAllowed' : 'images.accessDenied')}<p>{t(override ? 'images.accessOverride' : retained ? 'images.accessRetained' : 'images.accessInherited')}</p></td>
            <td><ButtonLink size="small" to="/admin/projects/$projectId/resources" params={{ projectId: project.id }}>{t('images.manageAccess')}</ButtonLink></td></tr>;
        })}
      </DataTable></> : null}
  </div>;
}
