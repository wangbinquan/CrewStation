import { useParams, useSearch, useNavigate } from '@tanstack/react-router';
import { DatabaseMigrationDtoSchema, DatabaseMigrationListSchema, DatabaseMigrationStageSchema } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { useProjectScope } from '../../../shared/project/ProjectScope';
import { PROJECT_PATHS, RELEASE_PATHS } from '../../../shared/project/projectPaths';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { ButtonLink } from '../../../shared/ui/navigation/ButtonLink';
import { DataTable } from '../../../shared/ui/DataTable';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { FormField } from '../../../shared/ui/FormField';
import { useServiceOfProject } from '../model/useServiceOfProject';
import { useReleasePermissions } from '../model/journey/useReleasePermissions';
import { migrationFinished, parseMigrationSearch } from '../model/database-migration/view';
import { MigrationCreate } from '../components/database-migration/MigrationCreate';
import { MigrationDetail } from '../components/database-migration/MigrationDetail';
import styles from './ReleasePage.module.css';
export function DatabaseMigrationPage(){
 const {projectId}=useProjectScope(),permissions=useReleasePermissions(projectId),service=useServiceOfProject(projectId);
 if(permissions.me.isPending||service.isPending)return <QueryStatus isPending error={null}/>;
 if(permissions.me.error||service.error||!service.serviceId||!permissions.userId)return <QueryStatus isPending={false} error={permissions.me.error??service.error}/>;
 return <MigrationWorkspace key={service.serviceId+permissions.userId+permissions.me.data?.isAdmin} serviceId={service.serviceId} userId={permissions.userId} canManage={permissions.me.data?.isAdmin===true}/>;
}
function MigrationWorkspace({serviceId,userId,canManage}:{serviceId:string;userId:string;canManage:boolean}){
 const t=useT(),{projectId,space}=useProjectScope(),{migrationId}=useParams({strict:false}),search=parseMigrationSearch(useSearch({strict:false})),navigate=useNavigate();
 const list=useApiQuery(['database-migrations',serviceId],async()=>DatabaseMigrationListSchema.parse(await api.services.listDatabaseMigrations(serviceId)),{refetchIntervalMs:5000});
 const detail=useApiQuery(['database-migration',serviceId,migrationId],async()=>DatabaseMigrationDtoSchema.parse(await api.services.getDatabaseMigration(serviceId,migrationId!)),{enabled:!!migrationId,refetchIntervalMs:op=>migrationFinished(op)?undefined:3000});
 return <div className={styles.stack}>
  <PageHeader title={t('release.migration.title')} description={[t('release.migration.intro')]} actions={migrationId?<ButtonLink to={RELEASE_PATHS[space].migrations} params={{projectId}} search={search}>{t('release.migration.back')}</ButtonLink>:undefined}/>
  {!canManage?<ActionNote tone="neutral">{t('release.migration.adminOnly')}</ActionNote>:null}
  <QueryStatus isPending={list.isPending||!!migrationId&&detail.isPending} error={list.error??detail.error}/>
  {migrationId?detail.data&&!detail.error?<MigrationDetail op={detail.data} serviceId={serviceId} canManage={canManage}/>:null:<>
   {canManage?<MigrationCreate serviceId={serviceId} userId={userId} filter={search.filter}/>:null}
   <FormField label={t('release.migration.filter')}><select value={search.filter??''} onChange={e=>void navigate({to:RELEASE_PATHS[space].migrations,params:{projectId},search:{filter:e.target.value||undefined},replace:true})}><option value="">{t('release.migration.all')}</option>{DatabaseMigrationStageSchema.options.map(stage=><option key={stage} value={stage}>{t(`release.migration.stage.${stage}`)}</option>)}</select></FormField>
   {list.data?.items.length&&!list.error?<DataTable columns={[t('release.migration.operation'),t('release.migration.state'),t('release.migration.candidate'),t('release.migration.details')]}>{list.data.items.filter(op=>!search.filter||op.stage===search.filter).map(op=><tr key={op.id}><td><code>{op.id}</code></td><td>{t(`release.migration.stage.${op.stage}`)}</td><td>{op.candidateTag}</td><td><ButtonLink to={RELEASE_PATHS[space].migration} params={{projectId,migrationId:op.id}} search={search}>{t('release.migration.details')}</ButtonLink></td></tr>)}</DataTable>:!list.isPending?<EmptyState title={t('release.migration.empty')}/>:null}
   <ButtonLink to={PROJECT_PATHS[space].release} params={{projectId}}>{t('release.migration.releases')}</ButtonLink>
  </>}
 </div>;
}
