import type {CompleteWorkingRows,CompleteWorkingPage} from '../../../ports/completeWorkingRows';
import type {UsageNativeCapture,RuntimeNativePagedCapture} from '@crewstation/contracts';
import type {CompleteRuntimeAllocation} from '../../../ports/completeRuntimeTask';
import {runtimeNativeQuality,runtimeRecordCapture} from '../../../domain/runtime/runtimeNativeQuality';
import {completeObservedIdentity} from '../../../domain/completeRuntimeIdentity';
import {jsonHash} from '@crewstation/kernel';
export async function* qualifiedProofRows(rows:CompleteWorkingRows,spaces:{captures:string;'native-pages':string;allocations:string},signal:AbortSignal){
 for(const role of ['captures','native-pages'] as const)for await(const row of traversal<UsageNativeCapture|RuntimeNativePagedCapture>(rows,spaces[role],signal)){const q=runtimeNativeQuality(row.document);yield {role:'capture-quality',key:jsonHash(q.captureIdentity),document:{...q,attemptKey:jsonHash(q.identity)}};}
 for await(const row of traversal<CompleteRuntimeAllocation>(rows,spaces.allocations,signal)){const original=row.document.record.original,id=runtimeRecordCapture(original);yield {role:'proof-links',key:row.key,document:{attemptKey:jsonHash(completeObservedIdentity(original.identity)),captureKey:id===null?null:jsonHash(id)}};}
}

async function* traversal<T>(rows:CompleteWorkingRows,namespace:string,signal:AbortSignal){let after:string|null=null;do{signal.throwIfAborted();const page:CompleteWorkingPage<T>=await rows.page<T>(namespace,after,200);for(const row of page.items)yield row;after=page.nextCursor;}while(after!==null);}
