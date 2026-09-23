export type { OwnerLedger, ResourcesModuleApi } from './api/moduleApi';
export type {
  ChildObservation, ConditionUpdate, ExpectedChild, LedgerRecord, ObservationOutcome, OwnerTransaction, RecordFilter, ResourceActionHandler, ResourceAlias,
  ResourceDeclaration, ResourceLeases, ResourceReport, ResourceSpec, ResourceWriter, StreamSubscription, ViewerAccess,
} from './api/types';
export { createResourcesModule, resourcesMigrations } from './wiring';
export type { ResourcesModule, ResourcesModuleDeps } from './wiring';
