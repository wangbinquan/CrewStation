import {sql} from 'drizzle-orm';
import type {Executor} from '@crewstation/persistence';
export async function publishRuntimeScope(tx:Executor,project:string){await tx.execute(sql`INSERT INTO observability.runtime_projection_scopes(project_id,revision,as_of) VALUES(${project},1,to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) ON CONFLICT(project_id) DO UPDATE SET revision=observability.runtime_projection_scopes.revision+1,as_of=excluded.as_of`);}
