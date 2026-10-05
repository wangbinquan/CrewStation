export type { DataModuleApi } from './api/moduleApi';
export { createDataModule, createDataObjectDeletionPhysics, dataMigrations } from './wiring';
export type { DataModule, DataModuleDeps } from './wiring';
export { createObjectBackupTools } from './wiring';
export { objectPlanAllocationRevision, objectSpaceAllocationRevision } from './api/allocationRevision';
