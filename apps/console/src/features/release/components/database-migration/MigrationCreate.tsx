import { useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { CreateDatabaseMigrationSchema, DatabaseMigrationDtoSchema, DatabaseGenerationListSchema, ReleaseIdSchema } from '@crewstation/contracts';
import type { CreateDatabaseMigration } from '@crewstation/contracts';
import { api } from '../../../../shared/api/client';
import { useApiMutation, useApiQuery } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { resourceRequestId } from '../../../../shared/lib/resourceRequestId';
import { useProjectScope } from '../../../../shared/project/ProjectScope';
import { RELEASE_PATHS } from '../../../../shared/project/projectPaths';
import { Button } from '../../../../shared/ui/Button';
import { FormField } from '../../../../shared/ui/FormField';
import { FormDialog } from '../../../../shared/ui/dialog/FormDialog';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import { UnsavedChangesGuard } from '../../../../shared/navigation/UnsavedChangesGuard';
import { readMigrationIntent, saveMigrationIntent, clearMigrationIntent, migrationIntentKey } from '../../model/database-migration/intent';
export function MigrationCreate({serviceId,userId,filter}:{serviceId:string;userId:string;filter?:string}){
 const t=useT(),{projectId,space}=useProjectScope(),navigate=useNavigate(),key=migrationIntentKey(serviceId,userId),[saved]=useState(()=>readMigrationIntent(sessionStorage,key));
 const [open,setOpen]=useState(!!saved.intent),[intent,setIntent]=useState<CreateDatabaseMigration|null>(saved.intent),[error,setError]=useState(saved.error);
 const [branch,setBranch]=useState(saved.intent?.branch??'main'),[sha,setSha]=useState(saved.intent?.expectedCommitSha??''),accepted=useRef<string|null>(null);
 const generations=useApiQuery(['database-generations',serviceId],async()=>DatabaseGenerationListSchema.parse(await api.services.databaseGenerations(serviceId)),{refetchIntervalMs:5000});
 const slots=useApiQuery(['database-migration-slots',serviceId],()=>api.services.listSlots(serviceId),{refetchIntervalMs:5000});
 const create=useApiMutation(async(input:CreateDatabaseMigration)=>{
  const op=DatabaseMigrationDtoSchema.parse(await api.services.createDatabaseMigration(serviceId,input));
  if(op.id!==input.requestId||op.serviceId!==serviceId||op.createdBy!==userId||op.sourceGenerationId!==input.expectedActiveGenerationId||op.sourceReleaseId!==input.expectedActiveReleaseId||op.branch!==input.branch||op.commitSha!==input.expectedCommitSha)throw new Error(t('release.migration.responseMismatch'));
  return op;
 },{invalidate:[['database-migrations',serviceId],['database-generations',serviceId]],onSuccess:op=>{
  try{clearMigrationIntent(sessionStorage,key,op.id);}catch{setError('release.migration.intentUnavailable');}
  accepted.current=RELEASE_PATHS[space].migration.replace('$projectId',projectId).replace('$migrationId',op.id);setOpen(false);setIntent(null);setSha('');
  void navigate({to:RELEASE_PATHS[space].migration,params:{projectId,migrationId:op.id},search:{filter}});
 }});
 const active=slots.data?.items.find(s=>s.name==='prod')?.releaseId,blocked=!!generations.data?.active.restoreOperationId||!!generations.data?.active.migrationOperationId;
 const submit=()=>{if(!active||!generations.data)return;const input=intent??CreateDatabaseMigrationSchema.parse({requestId:resourceRequestId(),expectedActiveReleaseId:ReleaseIdSchema.parse(active),expectedActiveGenerationId:generations.data.active.generationId,branch,expectedCommitSha:sha});try{saveMigrationIntent(sessionStorage,key,input);setIntent(input);create.mutate(input);}catch{setError('release.migration.intentUnavailable');}};
 return <>
  <UnsavedChangesGuard dirty={!!sha||!!intent||create.isPending} scope={t('release.migration.title')} allowNavigate={(_,next)=>next.pathname===accepted.current}/>
  {error?<ActionNote tone="error">{t('release.migration.intentUnavailable')}</ActionNote>:null}
  <Button disabled={!!error||!!generations.error||!!slots.error||!active||!generations.data||blocked&&!intent} onClick={()=>setOpen(true)}>{t('release.migration.new')}</Button>
  {open?<FormDialog title={t('release.migration.new')} submitLabel={t('release.migration.create')} onSubmit={submit} onClose={()=>setOpen(false)} busy={create.isPending} submitDisabled={!!error||!active||!branch||!/^[a-f0-9]{40}$/.test(sha)||!!generations.error||!!slots.error} error={create.error?.message} onClear={intent?undefined:()=>{setBranch('main');setSha('');create.reset();}} dirty={!!sha||!!intent}>
   <ActionNote tone="neutral">{t('release.migration.intro')}</ActionNote>
   <FormField label={t('release.migration.branch')}><input value={branch} disabled={!!intent} onChange={e=>setBranch(e.target.value)}/></FormField>
   <FormField label={t('release.migration.commit')}><input value={sha} disabled={!!intent} onChange={e=>setSha(e.target.value)}/></FormField>
   {intent?<ActionNote tone="neutral">{t('release.migration.sameRequest')} <code>{intent.requestId}</code></ActionNote>:null}<QueryStatus isPending={generations.isPending||slots.isPending} error={generations.error??slots.error}/>
  </FormDialog>:null}
 </>;
}
