import { afterEach, describe, expect, test } from 'bun:test';
import { IDENTITY_HEADERS } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import { forbidden, newResourceId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { releaseImageFixture } from '../runtimeImageFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-038 HTTP authorization and strict contracts', () => {
  let f: Awaited<ReturnType<typeof releaseImageFixture>>;
  afterEach(async () => { await f?.close(); });
  test('exact history reads, verification receipt, 401/403/404 and strict input leave unauthorized journals unchanged', async () => {
    f = await releaseImageFixture(false, () => ({ authorizer: { authorize: async actor => { if (actor.userId !== f.actor.userId) throw forbidden('项目成员身份不匹配'); } } }));
    const allowed = f.actor.userId;
    const release = await f.runtime.api.publish(f.actor, f.serviceId, { branch: 'main', version: 'patch' });
    for (let i = 0; i < 3; i++) await f.runtime.api.runPipelineStep(release.id);
    const app = createApp({ name: 'journey-test' }); for (const router of f.runtime.http) app.route('/', router);
    const path = `/v1/release-journeys/${release.journeyId}`, headers = { [IDENTITY_HEADERS.userId]: allowed, 'content-type': 'application/json' };
    expect((await app.request(path)).status).toBe(401);
    expect((await app.request(path, { headers: { [IDENTITY_HEADERS.sourceService]: 'other/app' } })).status).toBe(403);
    expect((await app.request(path, { headers: { [IDENTITY_HEADERS.userId]: newResourceId() } })).status).toBe(403);
    expect((await app.request(`/v1/release-journeys/${newResourceId()}`, { headers })).status).toBe(404);
    expect((await app.request('/v1/release-journeys/not-canonical', { headers })).status).toBe(400);
    for (const suffix of ['?limit=51', '?cursor=malformed', '?extra=unexpected', '?filter=bad']) expect((await app.request(`/v1/services/${f.serviceId}/release-journeys${suffix}`, { headers })).status).toBe(400);
    const detail = await f.runtime.api.getJourney(f.actor, release.journeyId!);
    expect((await app.request(path, { headers })).status).toBe(200);
    expect((await app.request(`/v1/releases/${release.id}/journey-history`, { headers })).status).toBe(200);
    expect((await app.request(`/v1/services/${f.serviceId}/release-journeys?filter=active`, { headers })).status).toBe(200);
    const body = { requestKey: newResourceId(), expectedRevision: detail.revision, expectedReleaseId: release.id, expectedCommitSha: release.commitSha, expectedTargetRevision: detail.continuation.targetRevision! };
    expect((await app.request(`${path}/verification`, { method: 'POST', headers, body: JSON.stringify({ ...body, actorUserId: newResourceId() }) })).status).toBe(400);
    expect((await app.request(`${path}/verification`, { method: 'POST', headers: { ...headers, [IDENTITY_HEADERS.userId]: newResourceId() }, body: JSON.stringify(body) })).status).toBe(403);
    expect((await f.runtime.api.getJourney(f.actor, release.journeyId!)).revision).toBe(detail.revision);
    const verified = await app.request(`${path}/verification`, { method: 'POST', headers, body: JSON.stringify(body) });
    expect(verified.status).toBe(200); expect(await verified.json()).toMatchObject({ status: 'awaiting-confirmation', verification: { actorUserId: allowed } });
  });
});
