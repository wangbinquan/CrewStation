import type {CompleteWorkingRows} from '../../ports/completeWorkingRows';
import type {CompleteRuntimeTaskBuild,CompleteAttemptWorking} from '../../ports/completeRuntimeTask';
import type {CompleteRuntimeFactSources} from '../../ports/completeRuntimeFactSources';
import {completeWorkingTraversal} from '../completeWorkingTraversal';
/** Names are read through the same original owner snapshot; the bounded cache does not bound identities. */
export async function enrichQualifiedProfiles(rows:CompleteWorkingRows,build:CompleteRuntimeTaskBuild,facts:CompleteRuntimeFactSources,signal:AbortSignal){
 const names=new Map<string,string|null>(),raw=build.attemptsNamespace.replace(/attempt-summaries$/,'attempts');
 for await(const row of completeWorkingTraversal<CompleteAttemptWorking>(rows,raw,signal)){const p=row.document.attempt,id=p.profileId;if(!id||p.profileName)continue;let name=names.get(id);if(!names.has(id)){name=await facts.profileName(id);if(names.size===200)names.delete(names.keys().next().value!);names.set(id,name??null);}const attempt={...p,profileName:name??null};await rows.upsert(raw,[{key:row.key,document:{...row.document,attempt}}]);const summary=await rows.get<Record<string,unknown>>(build.attemptsNamespace,row.key);if(summary)await rows.upsert(build.attemptsNamespace,[{key:row.key,document:{...summary,profileName:name??null}}]);}
}
