import type {OperationalTelemetryQuery} from '@crewstation/contracts';
import type {OperationalMetricSeries} from '../domain/runtime/operationalMetricSeries';
export type {OperationalMetricSeries} from '../domain/runtime/operationalMetricSeries';
export interface OperationalMetricSource {
 availableFrom?():string|undefined;
 read(query:OperationalTelemetryQuery,namespace?:string,projectSlug?:string):Promise<readonly OperationalMetricSeries[]>;
}
