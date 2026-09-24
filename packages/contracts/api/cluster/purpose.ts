import { z } from 'zod';

/** 受管对象的用途（RFC-010）；资源中心的标准记录也用它（单放一个文件：集群资源行引用标准记录，标准记录又引用它，放在一起会循环引用）。 */
export const ClusterPurposeSchema = z.enum(['development-workspace', 'development-cli', 'development-agent', 'business-workspace', 'business-subtask', 'profile-test', 'digital-worker-service', 'api-proxy', 'event-producer', 'build', 'migration', 'platform-service', 'platform-infrastructure', 'unknown']);
