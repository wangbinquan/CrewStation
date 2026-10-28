import { useState } from 'react';
import type { DatabaseMigrationDto, DatabaseMigrationAction } from '@crewstation/contracts';
import { api } from '../../../../shared/api/client';
import { useApiMutation } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import { Card } from '../../../../shared/ui/Card';
import { DataTable } from '../../../../shared/ui/DataTable';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import { ConfirmationDialog } from '../../../../shared/ui/dialog/ConfirmationDialog';
import { ConfirmDialog } from '../../../../shared/ui/dialog/ConfirmDialog';
import { StageProgress } from '../../../../shared/ui/progress/StageProgress';
import { migrationProgress, sameMigrationConfirmation } from '../../model/database-migration/view';
import { MigrationFacts } from './MigrationFacts';
import styles from './MigrationDetail.module.css';
type Review={op:DatabaseMigrationDto;action:DatabaseMigrationAction};
async function mutate(serviceId:string,{op,action}:Review){
 const input={expectedRevision:op.revision};
 if(action==='approve')return api.services.approveDatabaseMigration(serviceId,op.id,{...input,approvalDigest:op.plan!.plan.approvalDigest});
 if(action==='switch')return api.services.switchDatabaseMigration(serviceId,op.id,{...input,confirmationDigest:op.confirmationDigest!});
 if(action==='open')return api.services.openDatabaseMigration(serviceId,op.id,{...input,confirmationDigest:op.confirmationDigest!});
 if(action==='rollback')return api.services.rollbackDatabaseMigration(serviceId,op.id,input);
 if(action==='abandon')return api.services.abandonDatabaseMigration(serviceId,op.id,input);
 if(action==='replan')return api.services.replanDatabaseMigration(serviceId,op.id,input);
 return api.services.retryDatabaseMigration(serviceId,op.id,input);
}
export function MigrationDetail({op,canManage,serviceId}:{op:DatabaseMigrationDto;canManage:boolean;serviceId:string}){
 const t=useT(),[review,setReview]=useState<Review|null>(null);
 const action=useApiMutation((input:Review)=>mutate(serviceId,input),{invalidate:[['database-migrations',serviceId],['database-migration',serviceId],['database-generations',serviceId]],onSuccess:()=>setReview(null)});
 const stale=!!review&&!sameMigrationConfirmation(op,review.op,review.action),typed=review?.action==='rollback'||review?.action==='abandon';
 return <>
  <Card title={t(`release.migration.stage.${op.stage}`)} stacked><StageProgress progress={migrationProgress(op)} label={stage=>t(`release.migration.stage.${stage.kind}`)}/><MigrationFacts op={op}/></Card>
  {op.error?<ActionNote tone="error">{op.error}</ActionNote>:null}{op.observation?<ActionNote tone="neutral">{op.observation.message}</ActionNote>:null}
  <MigrationPlan op={op} serviceId={serviceId}/>
  <Card title={t('release.migration.evidence')} stacked>{op.attempts.map(a=><div key={a.jobId}><code className={styles.identity}>{a.jobId} · {a.purpose} · {a.receipt?.state??'pending'} · {a.receipt?.failure??''} · {a.receiptDigest??''}</code>{a.logTail?<pre className={styles.evidence}>{a.logTail}</pre>:null}</div>)}</Card>
  {canManage?op.actions.map(kind=><Button key={kind} disabled={action.isPending} variant={kind==='rollback'||kind==='abandon'?'danger':'secondary'} onClick={()=>kind==='retry'||kind==='replan'?action.mutate({op,action:kind}):setReview({op,action:kind})}>{t(`release.migration.action.${kind}`)}</Button>):null}
  <QueryStatus isPending={false} error={action.error}/>
  {canManage&&review?(typed?<ConfirmDialog title={t(`release.migration.action.${review.action}`)} question={t('release.migration.rollbackImpact')} confirmWord={review.action==='rollback'?'rollback':'abandon'} confirmLabel={t(`release.migration.confirm.${review.action}`)} busy={action.isPending} confirmDisabled={stale} onCancel={()=>setReview(null)} onConfirm={()=>action.mutate(review)}><MigrationFacts op={review.op}/>{stale?<ActionNote tone="error">{t('release.migration.stale')}</ActionNote>:null}</ConfirmDialog>:
   <ConfirmationDialog title={t(`release.migration.action.${review.action}`)} question={t(review.action==='open'?'release.migration.openImpact':review.action==='approve'?'release.migration.approveImpact':'release.migration.switchImpact')} confirmLabel={t(`release.migration.confirm.${review.action}`)} busy={action.isPending} confirmDisabled={stale} onCancel={()=>setReview(null)} onConfirm={()=>action.mutate(review)} actions={stale?<Button onClick={()=>setReview({...review,op})}>{t('release.migration.recheck')}</Button>:undefined}><MigrationFacts op={review.op}/>{stale?<ActionNote tone="error">{t('release.migration.stale')}</ActionNote>:null}<QueryStatus isPending={false} error={action.error}/></ConfirmationDialog>):null}
 </>;
}
function MigrationPlan({op,serviceId}:{op:DatabaseMigrationDto;serviceId:string}){
 const t=useT(),download=useApiMutation(async()=>{const {markdown}=await api.services.databaseMigrationPlanMarkdown(serviceId,op.id),url=URL.createObjectURL(new Blob([markdown],{type:'text/markdown'})),link=document.createElement('a');link.href=url;link.download=`migration-${op.id}.md`;link.click();URL.revokeObjectURL(url);});
 const plan=op.plan?.plan.payload;
 return plan?<Card title={t('release.migration.plan')} stacked>
  <DefinitionText label={t('release.migration.source')} value={plan.source}/><DefinitionText label={t('release.migration.target')} value={plan.target}/>
  <DataTable columns={[t('release.migration.blocks')]}>{plan.blocks.map((block,n)=><tr key={n}><td>{JSON.stringify(block)}</td></tr>)}</DataTable>
  <DefinitionText label={t('release.migration.restrictions')} value={plan['restrictions']}/><DefinitionText label={t('release.migration.acknowledge')} value={op.plan?.acknowledgeable}/>
  <DefinitionText label={t('release.migration.estimates')} value={plan.estimates}/><DefinitionText label={t('release.migration.guidance')} value={op.plan?.guidance}/>
  <Button disabled={download.isPending} onClick={()=>download.mutate(undefined)}>{t('release.migration.download')}</Button><QueryStatus isPending={false} error={download.error}/>
 </Card>:null;
}
function DefinitionText({label,value}:{label:string;value:unknown}){return <div><strong>{label}</strong><pre className={styles.evidence}>{JSON.stringify(value??null,null,2)}</pre></div>;}
