export interface OperationalHistoryService {namespace:string;name:string;roles:readonly {at:string;active:'blue'|'green';blue:string|null;green:string|null;blueName:string|null;greenName:string|null}[];maintenance:readonly {at:string;enabled:boolean}[]}
export interface OperationalHistorySeries {labels:Readonly<Record<string,string>>;values:readonly (readonly [number,string])[]}
export interface OperationalHistorySource {availableFrom?():string|undefined;read(q:{from:string;to:string},namespace?:string,projectSlug?:string):Promise<readonly OperationalHistorySeries[]>}
