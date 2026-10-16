import {useRef,useState} from 'react';
import {readRestoreIntent,saveRestoreIntent,clearRestoreIntent,restoreIntentKey} from '../model/restoreIntent';
import {useNavigate,useParams,useSearch} from '@tanstack/react-router';
import {DatabaseRestoreDtoSchema,DatabaseGenerationListSchema,ReleaseIdSchema,DatabaseRestoreStageSchema} from '@crewstation/contracts';
import type {CreateDatabaseRestore,DatabaseRestoreDto} from '@crewstation/contracts';
import {api} from '../../../shared/api/client';
import {useApiQuery,useApiMutation} from '../../../shared/api/useApi';
import {useT} from '../../../shared/lib/useT';
import {resourceRequestId} from '../../../shared/lib/resourceRequestId';
import {useProjectScope} from '../../../shared/project/ProjectScope';
import {PROJECT_PATHS,RELEASE_PATHS} from '../../../shared/project/projectPaths';
import {PageHeader} from '../../../shared/ui/PageHeader';
import {Button} from '../../../shared/ui/Button';
import {ButtonLink} from '../../../shared/ui/navigation/ButtonLink';
import {Card} from '../../../shared/ui/Card';
import {DataTable} from '../../../shared/ui/DataTable';
import {DefinitionList} from '../../../shared/ui/DefinitionList';
import {QueryStatus} from '../../../shared/ui/QueryStatus';
import {ActionNote} from '../../../shared/ui/ActionNote';
import {EmptyState} from '../../../shared/ui/EmptyState';
import {FormField} from '../../../shared/ui/FormField';
import {FormDialog} from '../../../shared/ui/dialog/FormDialog';
import {ConfirmationDialog} from '../../../shared/ui/dialog/ConfirmationDialog';
import {StageProgress} from '../../../shared/ui/progress/StageProgress';
import {UnsavedChangesGuard} from '../../../shared/navigation/UnsavedChangesGuard';
import {useReleasePermissions} from '../model/journey/useReleasePermissions';
import {useServiceOfProject} from '../model/useServiceOfProject';
import {parseRestoreSearch,restoreProgress,sameRestoreConfirmation} from '../model/databaseRestore';
import styles from './ReleasePage.module.css';
export function DatabaseRestorePage(){
 const {projectId}=useProjectScope(),permissions=useReleasePermissions(projectId),service=useServiceOfProject(projectId);
 const allowed=!permissions.me.error&&!!permissions.me.data,canManage=allowed&&permissions.me.data?.isAdmin===true;
 if(permissions.me.isPending||service.isPending)return <QueryStatus isPending error={null}/>;
 if(!allowed)return <DatabaseRestoreDenied/>;
 return service.serviceId&&!service.error?<RestoreWorkspace key={service.serviceId+permissions.userId+canManage} serviceId={service.serviceId} userId={permissions.userId!} canManage={canManage}/>:<QueryStatus isPending={false} error={service.error}/>;
}
function DatabaseRestoreDenied(){const t=useT();return <ActionNote tone="error">{t('release.restore.adminOnly')}</ActionNote>;}
function RestoreWorkspace({serviceId,userId,canManage}:{serviceId:string;userId:string;canManage:boolean}){
 const t=useT(),{projectId,space}=useProjectScope(),navigate=useNavigate(),{restoreId}=useParams({strict:false}),search=parseRestoreSearch(useSearch({strict:false}));
 const list=useApiQuery(['database-restores',serviceId],()=>api.services.listDatabaseRestores(serviceId),{refetchIntervalMs:5000});
 const generations=useApiQuery(['database-generations',serviceId],async()=>DatabaseGenerationListSchema.parse(await api.services.databaseGenerations(serviceId)),{refetchIntervalMs:5000});
 const detail=useApiQuery(['database-restore',serviceId,restoreId],async()=>DatabaseRestoreDtoSchema.parse(await api.services.getDatabaseRestore(serviceId,restoreId!)),{enabled:!!restoreId,refetchIntervalMs:data=>data?.stage==='completed'?undefined:3000});
 const releases=useApiQuery(['database-restore-releases',serviceId],()=>api.services.listReleases(serviceId));
 const slots=useApiQuery(['database-restore-slots',serviceId],()=>api.services.listSlots(serviceId),{refetchIntervalMs:5000});
 const intentKey=restoreIntentKey(serviceId,userId),[saved]=useState(()=>readRestoreIntent(sessionStorage,intentKey));
 const [intentError,setIntentError]=useState(saved.error),acceptedPath=useRef<string|null>(null);
 const [open,setOpen]=useState(canManage&&!!saved.intent),[reference,setReference]=useState(saved.intent?.backupReference??''),[releaseId,setReleaseId]=useState(saved.intent?.restoreReleaseId??''),[intent,setIntent]=useState<CreateDatabaseRestore|null>(saved.intent),[review,setReview]=useState<DatabaseRestoreDto|null>(null);
 const invalidations=[['database-restores',serviceId],['database-restore',serviceId],['database-generations',serviceId]];
 const create=useApiMutation(async(input:CreateDatabaseRestore)=>{const op=DatabaseRestoreDtoSchema.parse(await api.services.createDatabaseRestore(serviceId,input));if(op.id!==input.requestId||op.serviceId!==serviceId||op.createdBy!==userId||op.sourceGenerationId!==input.expectedActiveGenerationId||op.sourceReleaseId!==input.expectedActiveReleaseId||op.restoreReleaseId!==input.restoreReleaseId||op.backupReference!==input.backupReference)throw new Error(t('release.restore.responseMismatch'));return op;},{invalidate:invalidations,onSuccess:op=>{try{clearRestoreIntent(sessionStorage,intentKey,op.id);}catch{setIntentError('release.restore.intentUnavailable');}acceptedPath.current=RELEASE_PATHS[space].database.replace('$projectId',projectId).replace('$restoreId',op.id);setOpen(false);setIntent(null);setReference('');setReleaseId('');void navigate({to:RELEASE_PATHS[space].database,params:{projectId,restoreId:op.id},search});}});
 const retry=useApiMutation((op:DatabaseRestoreDto)=>api.services.retryDatabaseRestore(serviceId,op.id,{expectedRevision:op.revision}),{invalidate:invalidations});
 const activate=useApiMutation((op:DatabaseRestoreDto)=>api.services.switchDatabaseRestore(serviceId,op.id,{expectedRevision:op.revision,confirmationDigest:op.confirmationDigest!}),{invalidate:invalidations,onSuccess:()=>setReview(null)});
 const active=slots.data?.items.find(s=>s.name==='prod')?.releaseId;
 const rows=list.error?[]:list.data?.items??[],current=detail.error?undefined:detail.data;
 const busy=create.isPending||activate.isPending||retry.isPending;
 const submit=()=>{if(!generations.data||!active)return;const input=intent??{requestId:resourceRequestId(),expectedActiveGenerationId:generations.data.active.generationId,expectedActiveReleaseId:ReleaseIdSchema.parse(active),restoreReleaseId:ReleaseIdSchema.parse(releaseId),backupReference:reference.trim()};try{saveRestoreIntent(sessionStorage,intentKey,input);setIntentError(null);setIntent(input);create.mutate(input);}catch{setIntentError('release.restore.intentUnavailable');}};
 const listBack=<ButtonLink to={RELEASE_PATHS[space].databases} params={{projectId}} search={search}>{t('release.restore.back')}</ButtonLink>;
 return <div className={styles.stack}>
  {!canManage?<ActionNote tone="neutral">{t('release.restore.adminOnly')}</ActionNote>:null}
  <UnsavedChangesGuard dirty={!!reference||!!releaseId||!!intent||busy} scope={t('release.restore.title')} allowNavigate={(_,next)=>next.pathname===acceptedPath.current}/>
  {intentError?<ActionNote tone="error">{t(intentError as 'release.restore.intentUnavailable')}</ActionNote>:null}
  <PageHeader title={t('release.restore.title')} description={[t('release.restore.intro')]} actions={restoreId?listBack:canManage?<Button onClick={()=>setOpen(true)} disabled={!!intentError||!!generations.error||!generations.data||(!intent&&!!generations.data.active.restoreOperationId)||!!list.error||busy}>{t('release.restore.new')}</Button>:undefined}/>
  <QueryStatus isPending={list.isPending||generations.isPending||!!restoreId&&detail.isPending} error={list.error??generations.error??detail.error}/>
  {restoreId&&current?<>
   <Card title={t(`release.restore.stage.${current.stage}`)}><StageProgress progress={restoreProgress(current)} label={stage=>t(`release.restore.stage.${stage.kind}`)}/><RestoreFacts op={current}/></Card>
   {current.error?<ActionNote tone="error">{current.error}</ActionNote>:null}
   <ActionNote tone="neutral">{t(current.stage==='completed'?'release.restore.retained':'release.restore.separate')}</ActionNote>
   <Card title={t('release.restore.verification')}><DefinitionList items={[{label:t('release.restore.restoreJob'),value:current.restoreJob?`${current.restoreJob.state} · ${current.restoreJob.uid}`:'—'},{label:t('release.restore.verifyJob'),value:current.verifyJob?`${current.verifyJob.state} · ${current.verifyJob.uid}`:'—'},{label:t('release.restore.schema'),value:current.verification?.schemaDigest??'—'},{label:t('release.restore.autoResume'),value:current.verification?.autoResumeSuspended?t('release.restore.suspended'):'—'}]}/></Card>
   {current.previousAttempts.length?<Card title={t('release.restore.attempts')}><DataTable columns={[t('release.restore.operation'),t('release.restore.state')]}>{current.previousAttempts.map(attempt=><tr key={attempt.jobId}><td><code>{attempt.jobId}</code></td><td>{attempt.receipt.state} · {attempt.receipt.uid}</td></tr>)}</DataTable></Card>:null}
   {canManage&&current.actions.includes('switch')?<Button variant="primary" disabled={busy||!!detail.error} onClick={()=>setReview(current)}>{t('release.restore.switch')}</Button>:null}
   {canManage&&current.actions.includes('retry')&&current.error?<Button disabled={busy} onClick={()=>retry.mutate(current)}>{t('release.restore.retry')}</Button>:null}
   <QueryStatus isPending={false} error={retry.error??activate.error}/>
  </>:!restoreId?<>
   <Card title={t('release.restore.generations')}><DataTable columns={[t('release.restore.generation'),t('release.restore.state')]}>{generations.data?.items.filter(g=>g.env==='production').map(g=><tr key={g.id}><td><code>{g.id}</code></td><td>{t(`release.restore.generation.${g.state}`)}</td></tr>)}</DataTable></Card>
   <FormField label={t('release.restore.filter')}><select value={search.filter??''} onChange={e=>void navigate({to:RELEASE_PATHS[space].databases,params:{projectId},search:{filter:e.target.value||undefined},replace:true})}><option value="">{t('release.restore.all')}</option>{DatabaseRestoreStageSchema.options.map(stage=><option key={stage} value={stage}>{t(`release.restore.stage.${stage}`)}</option>)}</select></FormField>
   {rows.length?<DataTable columns={[t('release.restore.operation'),t('release.restore.state'),t('release.restore.backup'),t('release.restore.details')]}>{rows.filter(op=>!search.filter||op.stage===search.filter).map(op=><tr key={op.id}><td><code>{op.id}</code></td><td>{t(`release.restore.stage.${op.stage}`)}</td><td>{op.backupReference}</td><td><ButtonLink to={RELEASE_PATHS[space].database} params={{projectId,restoreId:op.id}} search={search}>{t('release.restore.details')}</ButtonLink></td></tr>)}</DataTable>:!list.isPending?<EmptyState title={t('release.restore.empty')}/>:null}
   <ButtonLink to={PROJECT_PATHS[space].release} params={{projectId}}>{t('release.restore.releases')}</ButtonLink>
  </>:null}
  {canManage&&open?<FormDialog title={t('release.restore.new')} submitLabel={t('release.restore.prepare')} onSubmit={submit} onClose={()=>setOpen(false)} busy={create.isPending} submitDisabled={!!intentError||!releaseId||!reference.trim()||!active||!!generations.error||!!slots.error} error={create.error?.message} onClear={intent?undefined:()=>{setReference('');setReleaseId('');create.reset();}} dirty={!!reference||!!releaseId||!!intent}>
   <ActionNote tone="neutral">{t('release.restore.separate')}</ActionNote>
   <FormField label={t('release.restore.backup')}><input value={reference} maxLength={2048} disabled={!!intent} onChange={e=>setReference(e.target.value)}/></FormField>
   <FormField label={t('release.restore.version')}><select value={releaseId} disabled={!!intent} onChange={e=>setReleaseId(e.target.value)}><option value="">{t('release.restore.choose')}</option>{releases.data?.items.filter(release=>release.databaseRestoreSupported).map(release=><option key={release.id} value={release.id}>{release.tag} · {release.status}</option>)}</select></FormField>
   {intent?<ActionNote tone="neutral">{t('release.restore.sameRequest')} <code>{intent.requestId}</code></ActionNote>:null}
   <QueryStatus isPending={releases.isPending} error={releases.error??slots.error}/>
  </FormDialog>:null}
  {canManage&&review?<ConfirmationDialog title={t('release.restore.switch')} question={t('release.restore.confirm')} hint={t('release.restore.impact')} confirmLabel={t('release.restore.confirmAction')} busy={activate.isPending} confirmDisabled={!current||!sameRestoreConfirmation(current,review)||!!detail.error} onCancel={()=>setReview(null)} onConfirm={()=>activate.mutate(review)} actions={current&&!sameRestoreConfirmation(current,review)?<Button onClick={()=>setReview(current)}>{t('release.restore.recheck')}</Button>:undefined}>
   <RestoreFacts op={review}/>{current&&!sameRestoreConfirmation(current,review)?<ActionNote tone="error">{t('release.restore.stale')}</ActionNote>:null}<QueryStatus isPending={false} error={activate.error}/>
  </ConfirmationDialog>:null}
 </div>;
}
function RestoreFacts({op}:{op:DatabaseRestoreDto}){const t=useT();return <DefinitionList items={[{label:t('release.restore.operation'),value:op.id},{label:t('release.restore.backup'),value:op.backupReference},{label:t('release.restore.source'),value:op.sourceGenerationId},{label:t('release.restore.target'),value:op.targetGenerationId},{label:t('release.restore.image'),value:<code>{op.image}</code>},{label:t('release.restore.physical'),value:op.verifyJob?`${op.verifyJob.target.serverId} / ${op.verifyJob.target.databaseOid}`:'—'}]}/>;}
