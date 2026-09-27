import { surfaceSchema } from './contractSurface';
import { CreateBusinessTaskV3Schema, SubmitBusinessSubtaskV3Schema, RetryBusinessSubtaskV3Schema, BusinessTaskMutationSchema, BusinessSubtaskMutationSchema, BusinessSubtaskMessageV3Schema } from '../api/business/requests';
import { BusinessMaterialRequestSchema, BusinessMaterialDtoSchema } from '../api/business/materials';
import { BusinessFileQuerySchema, BusinessDirectoryQuerySchema, BusinessFileDtoSchema, BusinessDirectoryDtoSchema } from '../api/business/files';
import { BusinessControlActivateSchema, BusinessControlClaimSchema, BusinessControlDtoSchema, BusinessControlLeaseRequestSchema, BusinessHandoffReadySchema } from '../api/business/control';
import { BusinessEventPageSchema, BusinessEventQuerySchema } from '../api/business/events';
import { BusinessCapabilitiesDtoSchema } from '../api/business/capabilities';
import { BusinessOperationDtoSchema, BusinessOutputDtoSchema, BusinessSubtaskV3DtoSchema, BusinessTaskV3DtoSchema } from '../api/business/responses';

/** Include the complete external v3 surface in the same compatibility gate as deployed v2 clients. */
export function businessExecutionSurface() {
  const sent = {
    CreateBusinessTaskV3: CreateBusinessTaskV3Schema, SubmitBusinessSubtaskV3: SubmitBusinessSubtaskV3Schema, RetryBusinessSubtaskV3: RetryBusinessSubtaskV3Schema,
    BusinessTaskMutation: BusinessTaskMutationSchema, BusinessSubtaskMutation: BusinessSubtaskMutationSchema, BusinessSubtaskMessageV3: BusinessSubtaskMessageV3Schema,
    BusinessMaterialRequest: BusinessMaterialRequestSchema, BusinessFileQuery: BusinessFileQuerySchema, BusinessDirectoryQuery: BusinessDirectoryQuerySchema,
    BusinessControlActivate: BusinessControlActivateSchema, BusinessControlClaim: BusinessControlClaimSchema, BusinessControlLeaseRequest: BusinessControlLeaseRequestSchema,
    BusinessHandoffReady: BusinessHandoffReadySchema, BusinessEventQuery: BusinessEventQuerySchema,
  };
  const received = {
    BusinessTaskV3Dto: BusinessTaskV3DtoSchema, BusinessSubtaskV3Dto: BusinessSubtaskV3DtoSchema, BusinessOperationDto: BusinessOperationDtoSchema,
    BusinessOutputDto: BusinessOutputDtoSchema, BusinessMaterialDto: BusinessMaterialDtoSchema, BusinessFileDto: BusinessFileDtoSchema,
    BusinessDirectoryDto: BusinessDirectoryDtoSchema, BusinessControlDto: BusinessControlDtoSchema, BusinessEventPage: BusinessEventPageSchema,
    BusinessCapabilitiesDto: BusinessCapabilitiesDtoSchema,
  };
  return Object.fromEntries([
    ...Object.entries(sent).map(([name, schema]) => [name, surfaceSchema(schema, 'business-to-platform')]),
    ...Object.entries(received).map(([name, schema]) => [name, surfaceSchema(schema, 'platform-to-business')]),
  ]);
}
