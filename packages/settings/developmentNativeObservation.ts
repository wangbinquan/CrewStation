/** Installation-only validation cohort. It never filters historical reports. */
export interface DevelopmentNativeObservationAdmission {
  readonly projectId: string;
  readonly profileId: string;
  readonly profileRevision: number;
}

/** Missing/empty admissions keep the producer disabled; every supplied tuple is checked. */
export function developmentNativeObservationAdmissions(raw: string | undefined): readonly DevelopmentNativeObservationAdmission[] {
  if (raw === undefined) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw Error();
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const keys = new Set<string>();
    const admissions = parsed.map((entry: unknown): DevelopmentNativeObservationAdmission => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw Error();
      const value = entry as Record<string, unknown>;
      if (Object.keys(value).sort().join() !== 'profileId,profileRevision,projectId'
        || typeof value.projectId !== 'string' || !uuid.test(value.projectId)
        || typeof value.profileId !== 'string' || !uuid.test(value.profileId)
        || typeof value.profileRevision !== 'number' || !Number.isSafeInteger(value.profileRevision) || value.profileRevision < 1) throw Error();
      const result = { projectId: value.projectId.toLowerCase(), profileId: value.profileId.toLowerCase(), profileRevision: value.profileRevision };
      const key = JSON.stringify(result);
      if (keys.has(key)) throw Error();
      keys.add(key);
      return result;
    });
    return admissions.sort((a, b) => {
      const x = JSON.stringify(a), y = JSON.stringify(b);
      return x < y ? -1 : x > y ? 1 : 0;
    });
  } catch {
    throw Error('CS_DEVELOPMENT_NATIVE_OBSERVATION_ADMISSIONS 必须是无重复的 projectId/profileId/profileRevision 验证配置数组');
  }
}
