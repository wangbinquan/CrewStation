import { and, eq } from 'drizzle-orm';
import type { Executor } from '@crewstation/persistence';
import { conflict } from '@crewstation/kernel';
import { developmentMeterKey, developmentModelFingerprint, type DevelopmentModelEvidence } from '../../domain/developmentModelEvidence';
import type { UsageMeasurementRef } from '../../ports/usageLedger';
import { developmentModelEvidence } from './developmentUsageTables';

export async function readDevelopmentModel(db: Executor, ref: UsageMeasurementRef, revision: number): Promise<DevelopmentModelEvidence | undefined> {
  return (await db.select().from(developmentModelEvidence).where(and(eq(developmentModelEvidence.meterKey, developmentMeterKey(ref)),
    eq(developmentModelEvidence.revision, revision))).limit(1))[0]?.document;
}
export async function persistDevelopmentModel(db: Executor, value: DevelopmentModelEvidence): Promise<void> {
  const fingerprint = developmentModelFingerprint(value), prior = await readDevelopmentModel(db, value.meter, value.revision);
  if (prior) {
    if (developmentModelFingerprint(prior) !== fingerprint) throw conflict('开发用量原模型证据修订冲突');
    return;
  }
  await db.insert(developmentModelEvidence).values({ meterKey: developmentMeterKey(value.meter), revision: value.revision, fingerprint, document: value });
}
