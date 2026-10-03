import {useState,type ReactNode} from 'react';
import type {RuntimeReportPageQuery,RuntimeReportHeader} from '@crewstation/contracts';
import {api} from '../../../shared/api/client';
import {useApiQuery} from '../../../shared/api/useApi';
import {useT} from '../../../shared/lib/useT';
import {Button} from '../../../shared/ui/Button';
import {ActionRow} from '../../../shared/ui/ActionRow';
import {QueryStatus} from '../../../shared/ui/QueryStatus';
import {Stack} from '../../../shared/ui/Stack';
import {EmptyState} from '../../../shared/ui/EmptyState';
import {completeCount} from '../model/completeFormat';
import styles from './RuntimeStatistics.module.css';
const positions=new Map<string,readonly (string|undefined)[]>();
interface Props<T> {header:RuntimeReportHeader;section:RuntimeReportPageQuery['section'];parent?:string;rowKey?:string;children:(items:readonly T[])=>ReactNode;emptyKey?:string}
/** Page size limits one transport response, never the report population or any aggregate. */
export function RuntimeRows<T>(props:Props<T>) {
 const {header,section,parent,rowKey}=props,key=JSON.stringify([header.reportId,section,parent,rowKey]);
 return <RuntimeRowsPage<T> key={key} {...props} positionKey={key}/>;
}
function RuntimeRowsPage<T>({header,section,parent,rowKey,children,emptyKey='runtime.empty',positionKey}:Props<T>&{positionKey:string}) {
 const t=useT(),[cursors,setCursors]=useState<readonly (string|undefined)[]>(()=>positions.get(positionKey)??[undefined]);
 const after=cursors.at(-1),page=useApiQuery(['runtime-report-page',positionKey,after],()=>api.observability.runtimeReportPage<T>(header.projectId??undefined,header.reportId,{section,parent,rowKey,after,pageSize:100}));
 const change=(next:readonly (string|undefined)[])=>{positions.set(positionKey,next);setCursors(next);};
 const data=page.error?undefined:page.data;
 return <Stack data-runtime-section={section}><QueryStatus isPending={page.isPending} error={page.error}/>
  {data?data.items.length?children(data.items):<EmptyState title={t(emptyKey)}/>:null}
  <ActionRow><span className={styles.hint}>{data?t('runtime.pageCount',{shown:data.items.length,total:completeCount(data.total)}):t('runtime.pageLoading')}</span>
   <Button size="small" variant="ghost" disabled={page.isPending||cursors.length===1} onClick={()=>change([undefined])}>{t('runtime.firstPage')}</Button>
   <Button size="small" variant="ghost" disabled={page.isPending||cursors.length===1} onClick={()=>change(cursors.slice(0,-1))}>{t('runtime.previousPage')}</Button>
   <Button size="small" variant="ghost" disabled={page.isPending||!data?.nextCursor} onClick={()=>{if(data?.nextCursor)change([...cursors,data.nextCursor]);}}>{t('runtime.nextPage')}</Button>
  </ActionRow>
 </Stack>;
}

export function RuntimeItem<T>({header,section,parent,rowKey,children}:{header:RuntimeReportHeader;parent?:string;section:RuntimeReportPageQuery['section'];rowKey:string;children:(item:T)=>ReactNode}) {
 const t=useT(),identity=JSON.stringify([section,parent,rowKey]);
 const page=useApiQuery(['runtime-report-item',header.reportId,section,parent,rowKey],()=>api.observability.runtimeReportPage<T>(header.projectId??undefined,header.reportId,{section,parent,rowKey,pageSize:1}));
 const [previous,retain]=useState<{identity:string;item:T}>();
 const current=page.error?undefined:page.data?.items[0];
 if(current&&(previous?.identity!==identity||previous.item!==current))retain({identity,item:current});
 const item=current??(previous?.identity===identity?previous.item:undefined),visible=!page.error&&current!==undefined;
 return <><QueryStatus isPending={page.isPending} error={page.error}/>{item?<div hidden={!visible} inert={!visible}>{children(item)}</div>:null}{!page.error&&page.data&&!current?<EmptyState title={t('runtime.taskUnavailable')}/>:null}</>;
}
