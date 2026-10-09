import { ReleaseJourneyEventSchema } from '@crewstation/contracts';
import { ReleaseJourneySchema } from '../../../domain/journey/schema';

type Row = { table: string; body: Record<string, unknown> };
/** Checks the full retained graph, including rows outside the requested project's UI history page. */
export function validateJourneyContent(rows: readonly Row[], blocked: (code: string, message: string) => void): void {
  const releases = new Map(rows.filter((row) => row.table === 'releases').map((row) => [row.body.id, row.body]));
  const journeys = new Map(rows.filter((row) => row.table === 'release_journeys').map((row) => [row.body.id, row.body]));
  const eventRows = rows.filter((row) => row.table === 'release_journey_events');
  const invalid = () => blocked('release-journey-source-invalid', '发布流程出生、阶段或原版本关联不完整');
  for (const row of rows.filter(entry => entry.table === 'execution_handoffs')) {
    const handoff = row.body.body as Record<string, unknown> | undefined;
    if (!handoff?.journeyId) continue;
    const parent = journeys.get(handoff.journeyId);
    if (!parent || parent.project_id !== handoff.projectId || parent.service_id !== row.body.service_id || parent.release_id !== handoff.targetReleaseId) invalid();
  }
  for (const release of releases.values()) {
    const pipeline = release.pipeline as { journeyId?: string };
    if (pipeline?.journeyId) {
      const parent = journeys.get(pipeline.journeyId);
      if (!parent || parent.release_id !== release.id || parent.service_id !== release.service_id || parent.project_id !== release.project_id) invalid();
    }
  }
  for (const row of journeys.values()) {
    const parsed = ReleaseJourneySchema.safeParse(row.body), release = releases.get(row.release_id);
    if (!parsed.success || !release) { invalid(); continue; }
    const journey = parsed.data, snapshot = journey.snapshot;
    if (journey.id !== row.id || snapshot.projectId !== row.project_id || snapshot.serviceId !== row.service_id || snapshot.releaseId !== row.release_id
      || snapshot.kind !== row.kind || journey.status !== row.status || journey.revision !== row.revision || (journey.launch?.requestKey ?? null) !== row.request_key
      || snapshot.projectId !== release.project_id || snapshot.serviceId !== release.service_id || snapshot.tag !== release.tag
      || snapshot.branch !== release.branch || snapshot.commitSha !== release.commit_sha || Date.parse(snapshot.startedAt) !== Date.parse(String(row.created_at))) invalid();
    const events = eventRows.filter((event) => event.body.journey_id === row.id).map((event) => event.body).sort((a, b) => Number(a.sequence) - Number(b.sequence));
    if (events.length !== journey.revision || events.some((event, index) => event.sequence !== index + 1)) invalid();
    if (journey.launch) {
      const operation = journey.launch.operation;
      const original = rows.find((entry) => ['traffic_switches', 'execution_handoffs'].includes(entry.table) && entry.body.id === operation.id);
      const handoff = original?.body.body as Record<string, unknown> | undefined;
      if (!original || original.body.service_id !== snapshot.serviceId || operation.serviceId !== snapshot.serviceId
        || operation.releaseId !== snapshot.releaseId || operation.journeyId !== journey.id
        || (original.table === 'traffic_switches' ? original.body.release_id : handoff?.targetReleaseId) !== snapshot.releaseId) invalid();
    }
  }
  for (const { body: row } of eventRows) {
    const parsed = ReleaseJourneyEventSchema.safeParse(row.body), parent = journeys.get(row.journey_id);
    if (!parsed.success || !parent) { invalid(); continue; }
    const event = parsed.data;
    if (event.id !== row.id || event.journeyId !== row.journey_id || event.sequence !== row.sequence || event.transitionKey !== row.transition_key
      || parent.project_id !== row.project_id || parent.service_id !== row.service_id || parent.release_id !== row.release_id
      || Date.parse(event.at) !== Date.parse(String(row.created_at))) invalid();
    for (const id of [event.handoffId, event.trafficSwitchId].filter(Boolean)) {
      const source = rows.find((entry) => ['traffic_switches', 'execution_handoffs'].includes(entry.table) && entry.body.id === id);
      const releaseId = source?.table === 'traffic_switches' ? source.body.release_id : (source?.body.body as Record<string, unknown> | undefined)?.targetReleaseId;
      if (!source || source.body.service_id !== row.service_id || releaseId !== row.release_id) invalid();
    }
  }
}
