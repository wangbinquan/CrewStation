# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Read in this order at session start:**

1. `STATE.md` — session-to-session execution log: what is done, what is next, current caveats.
2. This file — repository status, commands, architecture, terminology.
3. `docs/engineering/development-rules.md` — **how to work here**: trunk-based development on `main` only, commit discipline on a shared working tree, the gate, test-with-every-change, the RFC workflow.
4. `docs/engineering/repository-structure.md` — the layout and dependency rules every new file must obey.
5. `docs/engineering/testing.md` — the test protection system: where each kind of test lives, which tests every kind of change must carry, what CI blocks, and the known protection gaps.
6. `docs/engineering/dev-gotchas.md` — general traps already hit in this repo; scan it before starting.

Three rules are violated most often: **develop only on `main`** (no branches, no worktrees, no stash — this repo explicitly overrides Claude Code's default "switch off the default branch" prompt); **stage and commit by explicit path** (`git add <path>`, `git commit -- <paths>`, never `git add .` on a shared tree); and **every change carries its tests**.

## Repository status

CrewStation (数字人能力平台: a platform on which teams build, publish and run "digital worker" business apps with coding agents) now holds **both** the design documents under `proposal/` and a working implementation. The three proposal documents are v0.3.6 (v0.3.5 backfills RFC-011 roles/home; v0.3.6 backfills RFC-010 managed cluster operations) and remain the authoritative contract; the code is the first implementation of that contract, verified on the local kind cluster, not a shipped product.

What exists in the cluster today (local `docker-desktop` kind node, namespace `crewstation-system`): the five resident services, both platform MCP servers, the workbench, Traefik, PostgreSQL, a registry and BuildKit. Chains that have actually been run end to end and observed, not inferred:

- Administrator creates a project, then namespace, quota and network policies, a GitLab repository from `templates/minimal-sample`, a production data resource, gateway routes, and a first tag release built and deployed to the preview slot.
- Traffic switch to prod and rollback, with both hosts serving and the audit record naming the release it came from.
- Demo login through the gateway, identity headers injected, the sample page reading the current user.
- A dev session container whose init container clones the repo at the chosen branch, whose TaskRunner connects to cs-session, and whose web terminal has a real controlling TTY with job control.
- The business subtask contract: the sample's `/chat` creates a business task, the subtask waits for the container, runs an agent and returns its output.
- Event delivery: the built-in EventProducer emits, cs-events dedups and fans out, and the sample page lists the delivery with its trace id.
- Both agent CLIs installed in the task image, launched under the dropped-privilege uid, reporting their native session ids.
- Both MCP servers reachable from inside a dev container, authenticated by the session-scoped token, returning real platform data.

RFC-010 (Done) adds `/admin/cluster` and the L6 cluster-management module for managed-resource inventory, exact Pod-purpose classification and durable lifecycle operations. Local RBAC was explicitly approved and applied; complete UID-based inventory, project and system lifecycle operations, finalizer recovery, and responsive UI were verified on the local cluster. See `proposal/rfc/RFC-010-cluster-management/acceptance.md` for operation evidence and exact-SHA publication checks.

Current verification limits: OpenCode 1.18.29 has produced real model output, run two native sessions concurrently, and edited a file in the dedicated RFC-003 verification project using the administrator-created Big Pickle profile. Claude Code still stops at login in that environment. RFC-004 (administrator-owned file provisioning and initialization scripts before Agent startup) is Superseded by RFC-006 (ruling C8). RFC-006 (a compute profile is the complete Agent execution configuration — protocol, platform-registry image pinned by digest, binary and arguments, before-start steps, variables and credentials, model, resources — tested on save; one Pod per Agent; TaskRunner protocol 2) is implemented and pushed. It is Done (2026-09-18): every CP item was checked on the local cluster — real OpenCode (Big Pickle) turns through profile tests, CLIs, headless Agents and business subtasks each in their own Pod, the sample's `/chat` through the default profile — except the Claude Code model turn (no login locally) and the no-default-profile case (not reproducible once a default exists); P1–P8, ADR-0005 and open questions I17–I19 await the author. RFC-003 is Done (2026-09-16): all 52 UX-AT acceptance tests passed live on the local cluster (the last, UX-AT-42 out-of-order redelivery, via a reversible fault injection), with the local gate and by-SHA CI green; its acceptance audit records each item's live evidence. Log paging still reads a bounded Pod log tail. Scale, HA and the installer (M6) are untouched, and `apps/cli`'s `install`/`upgrade` report their bundle-dependent phases as not-implemented rather than faking them. Open design questions remain recorded in `docs/engineering/implementation-open-questions.md` for the author to rule on.

## Commands

```
bun install                 # Bun 1.3.13 workspaces
bun run check               # the gate: arch:check → lint → typecheck → typecheck:console → test
bun run arch:check          # the eight structural rules (six architecture rules, test-discipline, migration-lock); no baseline, no exceptions list
bun test path/to/file.test.ts   # a single test file; run from the repo root
bun run migrations:lock <file>…   # after adding a migration: append it to tools/arch/migrations.lock.json (append-only; name your own files on the shared tree)
bun run contracts:lock      # after changing the business-facing contract surface; breaking changes need --breaking "<approved basis>"
bun run test:unit           # one execution tier: test:unit (method-level UT), test:module (module-level UT), test:console, test:e2e; add --cover for coverage/<tier>/ plus the tier audit
bun run test:cover          # all tests with coverage/lcov.info and coverage/junit.xml
bun run test:report         # render the last test:cover run the way the CI job summary does
bun run test:patch --base origin/main   # preview the new-code protection gate locally (after a full test:cover)
bun run scaffold:module <name>  # the only sanctioned way to create a module
./deploy/local/bootstrap.sh       # one-time local cluster prerequisites
./deploy/local/install-platform.sh  # build images, migrate, deploy; idempotent
./deploy/local/bootstrap-integrations.sh  # create the two built-in integration projects; idempotent
./deploy/local/verify.sh            # post-install checks (registry pull, routing, source IP, ForwardAuth)
```

`bun run check` must pass before any commit. Integration tests that need PostgreSQL or the local GitLab skip themselves when those are unreachable, so a green run on a bare machine does not mean the integration paths ran. CI runs one job per execution tier: `static` (the same `check:static` as the local gate), `unit` (method-level UT: colocated tests, no services, no skips allowed), `module` (module-level UT under each unit's `tests/`, real PostgreSQL), `console`, `gate` (merged report, the audit that every test file really ran, and new-code protection) and `e2e`; a push is green when `gate` and `e2e` are. The tiers are decided in one place, `tools/testguard/testTiers.ts`, and together equal everything `bun test` runs locally. CI names the environments it provides in `CS_TEST_REQUIRE` (`database` in `module`, `e2e,database` in `e2e`); there an unreachable environment fails the job instead of skipping. New-code protection: production files touched by a push must be loaded by some test, and at least 80% of the changed executable lines must be executed (`tools/testguard`, ADR-0007).

The `crewstation …` commands in Design §11–12 are the product CLI under `apps/cli`, not developer tooling.

## Repository structure and its rules

`docs/engineering/repository-structure.md` (v0.2, confirmed) governs the layout, and `tools/arch/` enforces it mechanically. Read it before adding a file. The rules exist because agent-workflow degraded without them; §0 quantifies that (172 flat files in one directory, an 8170-line schema file imported by 303 files).

Three classes of code: `apps/*` are deployable processes holding wiring only; `modules/*` are domain modules, each with a `layer`, importing only strictly lower layers and only through another module's root `index.ts`; `packages/*` are domain-free libraries. `runtimes/task` is the task container image, `integrations/*` and `templates/*` are standalone project sources rather than workspace members.

Every module follows one fixed template: `api/ domain/ application/ ports/ adapters/ http/ workers/ tests/` plus `wiring.ts` and `index.ts`. One PostgreSQL schema per module; cross-module references are IDs with no foreign keys, and one module never joins another's tables. A module that needs something from a higher layer declares a port and the composition root supplies it (`modules/platform/wiring.ts`).

Hard caps, enforced with no baseline: 600 lines per file (1000 for tests), 20 source files per directory, 80 lines per function. Banned filenames anywhere: `utils.ts`, `helpers.ts`, `common.ts`, `misc.ts`, `shared.ts`, and `types.ts` outside a module's `api/`. Named exports only; the single exception is recorded in ADR-0002. Changing any of this needs a new ADR under `docs/adr/`, not an edit in passing.

## Changing the product

The three `proposal/` documents are the baseline and describe the whole system. Anything beyond them — a new feature, a non-trivial refactor, a change in product behavior — goes through an RFC **before** code: three documents under `proposal/rfc/RFC-NNN-{slug}/`, registered in `proposal/rfc/README.md`, approved by the author. Spelling fixes, one-line bugs, renames, dependency bumps, docs and test additions skip it. The full process, including the extra bar for RFCs that close off an existing capability, is in `docs/engineering/development-rules.md` §5.

RFCs and ADRs do not overlap: an RFC changes product behavior, an ADR changes the repository's own structural rules. A change that does both needs one of each.

A design gap found while implementing is **not** decided on the spot — it goes into `docs/engineering/implementation-open-questions.md` with its options, for the author to rule on.

## The three documents

| File | Answers | Owns (v0.3.4 numbering) |
|---|---|---|
| `proposal/proposal.md` | Why, what, and what not | Sources S1–S9 (§0.1), change tables per version (§0.2), positioning (§2), **capability panorama and integration conventions (§3)**, product principles (§4), scenarios A–F (§5), **requirement baseline R01–R54 (§6)**, scope limits (§7), confirmed stack summary (§8), release and operations model (§9), risks (§10) |
| `proposal/design.md` | Objects, interfaces, runtime and data mechanisms | 22 invariants (§1.1), core objects (§1.2), deployment entities (§2), confirmed stack and adapter boundaries (§3), three Manifest kinds / persistence / API (§4), dev session and TaskRunner (§5), tag release and blue/green traffic switch (§6), user/service identity and roles (§7), API proxy, open policy and cs-events (§8), data (§9), task containers and business subtask contract (§10), install and upgrade (§11–12), traceability (§14), residual risks (§13.4), **decisions D01–D53 (§15.2), open questions Q01–Q24 (§15.3)** |
| `proposal/plan.md` | How requirements become tasks and evidence | Milestones M0–M6 with gates G0–G6, task rows `Tn.m` kept with 已删除 / 已作废 markers, **acceptance tests AT-01–AT-55 (§10)**, **traceability matrix R01–R54 → Design § → T → AT (§11)**, evidence layout (§12), deferred items (§13) |
| `proposal/tech-evaluation.md` | Which components and why | E01–E25: constraints, analysis, confirmed choice, alternative, what M0 must verify; confirmation log (§5) |
| `proposal/reviews/design-gate-2026-09-11.md` | What the gate review found and how the author ruled | Consolidated blockers/important/suggestions, the 25 rulings (§6), seven raw reports in the appendix |
| `docs/engineering/repository-structure.md` | How the code repository is organised | Root layout, apps/modules/packages classification, the module inventory with layers, module-internal template, dependency direction, one PostgreSQL schema per module, size caps 600/20/80, `tools/arch` enforcement, decision log |
| `docs/engineering/testing.md` | How changes stay protected by tests | Test tiers (from Plan §10.1), placement per unit, the tests each kind of change must carry, environment capabilities and `CS_TEST_REQUIRE`, the business contract surface golden, the migration lock, the CI jobs and the new-code protection gate, writing requirements, known protection gaps |

The two essays 《从个人提效到组织提效…》 and 《借鉴微信小程序…》 are the polished form of source S1; they are reference material and are intentionally not listed in the Proposal's source table.

## Conventions when editing the documents

- **Stable, shared identifiers.** R (requirements), S (sources), D (decisions), Q (open questions), `Tn.m` (task m of milestone Mn), G (gates), AT (acceptance tests). Never renumber or reuse a number. A withdrawn item keeps its row with 已删除 or 已作废 plus the replacing numbers (R06, R20 deleted in v0.3.0; R10–R13 superseded by R44–R47). Scenario letters may be re-lettered when one is deleted (v0.3.0 removed old B and shifted C–F to B–E), and every reference must then be updated.
- **Classify every statement.** Proposal uses 已明确要求 / 建议方案 / 待验证事项; Design uses 要求 / 基线 / 条件性选项 / 待决. Tag decisions with their source (S1–S9; S9 is the gate review and its rulings G1–G25). Do not promote a suggestion to a requirement without a source or a new user instruction.
- **No invented numbers or results.** Scale figures in the docs (hundreds of digital workers, hundreds of nodes) are stated design targets, never measurements. Do not write latency, RPO/RTO, success rates, or test outcomes that were not measured. AT entries are tests to be written; all tasks start as 未执行.
- **Keep the 目录** at the top of each file in sync with headings, and the three headers' version lines in sync when bumping.
- **Style.** Simplified Chinese prose with English identifiers in backticks; full-width `｜` in the H1, `／` for or/and, `＋` for plus. Cross-document section references use the target document's current numbering.
- **Work with the author by asking, not guessing.** The author confirmed the v0.3.x decisions and the 25 gate rulings round by round; unresolved design points go to them as questions (see the memory notes for this project) rather than being decided unilaterally.

## Terminology (use exactly)

- **数字人** (digital worker): a deployable business service with pages, API, events, DB, files and its own identity. First-version rule: one Project holds one DigitalWorkerService.
- **Two Agent purposes**: 意图创建与修改 Agent (`intent`) develops the app itself inside the dev container; 业务执行 Agent (`business`) is invoked by the business service through the subtask contract layer. There is **no role dimension** (no 主 Agent / coordinator, no 分析 / 编码 / 审核 roles); business subtasks carry only an `agentProfile` and an I/O contract.
- **开发会话**: the user-facing name of an intent TaskEnvironment: one long-lived dev container with a resident TaskRunner (own UID), multiple parallel streaming agents, web terminal, editor, preview, log page, publish controls. One project has at most one at a time; idle sessions only trigger reminders.
- **部署槽 (DeploymentSlot)**: preview and prod are the two blue/green slots of ONE production service. Both share the production database, files, identity and grants; the only difference is where the gateway routes traffic. 晋级 = TrafficSwitch by the project owner; rollback = switch back. Isolation lives between the dev session (development DB by default) and production, not between the slots.
- **用户域 / 服务域**: two gateway host classes. User domain: ForwardAuth login, injects identity headers plus a service-bound token. Service domain: no login redirect; the gateway resolves the caller by source Pod IP, evaluates the service allow-list locally, injects a platform-signed source token; carries internal API calls (`/api/<proxy>/…`), platform API calls, event pushes and service-to-service calls.
- **接入容器**: admin-built platform projects of Manifest kind `APIProxy` (pure forwarding of company APIs) or `EventProducer` (turns company webhooks into platform events). Built and released like any digital worker.
- **Five resident services**: `cs-api`, `cs-auth` (company login at the gateway, identity injection, workload-identity verification, on-demand upstream credentials), `cs-controller` (task containers, build, release, routing, data provisioning, GitLab management operations), `cs-session` (agent sessions, terminals, file streams), `cs-events` (event distribution center; formerly `cs-connector`). Plus two platform MCP servers: a capability-description MCP and an operations MCP.
- **Superseded, do not reintroduce:** 主 Agent / coordinator; agent roles; the foreground execution slot and single-writer rule; Checkpoint snapshots; `DevSession` as a separate object; `SandboxLease`; `ServiceEnvironment` as an isolated environment with its own data (now `DeploymentSlot`); `Promotion` (now `TrafficSwitch`); service identity via projected ServiceAccount tokens carried by business code (now source-Pod-IP lookup); per-request ForwardAuth for service calls; `api-docs.read` vs `api-debug.invoke`; ZIP import; the knowledge flywheel (traceability stays, extraction does not); Docker Compose mode; `auto-after-checks` auto-publish and `code-checkpoint`; `cs-connector` as an API Broker; `RunWorkspaceBinding`; `/v1/agent-runs`.

## Architecture as designed (v0.3.6)

### Scale and platform shape
Design target: the whole company, hundreds of digital-worker services running concurrently on a Kubernetes cluster of hundreds of nodes; one cluster in v1, multi-cluster deferred; control-plane HA is a v1 requirement. Kubernetes only; local validation runs on the docker-desktop kind cluster. Every component choice is evaluated against this target.

### Identity
The gateway authenticates users on the user domain and injects both trusted plaintext identity headers and a platform-signed token bound to the target service; business services write no login code and own their authorization rules. Services calling internal or platform APIs carry no credentials at all: the gateway resolves the caller by source Pod IP against a Pod identity index pushed by cs-controller (requires a CNI that preserves source IP; a Q21 prototype). Non-user traffic uses the service domain with a platform source token. Platform roles: user, developer, administrator. Every role lands on the application market; administrators include developer capabilities. Developers can create DigitalWorker projects using default resources and become the owner, and can develop only authorized projects. Administrators can manage the platform and integrations or create projects for eligible owners. Project membership is separate: owner (members, traffic switch, recovery, production settings), developer (development and standby releases), tester (application trial only). A user with trial membership sees an unpublished application with a Beta label on the market. Role changes recheck existing HTTP/CLI/WebSocket access; market cards and details never link to project editing. The global Agent activity menu is removed; native workspace status remains.

### Execution model
One task = one long-lived Pod in the project namespace, with a resident TaskRunner (own UID, realpath-checked file API, tini as PID 1) that dials out to cs-session. Each Agent (a 「＋ CLI」 terminal, a headless Agent, a business Agent subtask) runs in its own execution Pod that mounts the parent's work volume; its image, binary and resources come from the administrator's compute profile, and it takes one quota unit (RFC-006). Dev sessions get only primitives: developers start one or more streaming interactive agents in parallel (a registered deviation from agent-workflow's one-shot spawn, verified in T0.4) and the platform does not manage workspace sharing, branching, or merging. Business tasks keep the SubtaskRun contract layer: `agentProfile` and `outputContract` are declared in the Manifest `tasks` section and registered at release; subtasks run in `oneshot` or `interactive` mode, may run concurrently, coordinated by the business program. Storage follows the task: dev sessions always use a PV that follows the container and have only running/released states (idle → reminder only); business tasks may choose a persistent PV with a recreatable container, the only mode with pause/resume. The only budget is a per-digital-worker concurrent-task quota; overflow is always rejected. Claude Code's built-in sandbox is turned off inside task containers; model credentials enter as env vars (accepted residual risk).

### Source → release
Projects are created by an administrator who assigns the owner; one service ↔ one hosted GitLab-compatible Project plus one namespace, initialised with the minimal sample template (shows the current user, chats with an agent, receives one GitLab event) and built from its first tag into the preview slot already in M1. Publishing is a separate action: only a platform-created `v<major>.<minor>.<patch>` tag triggers a release; manual tags do nothing. Entry points: workbench button, CLI, and an agent-callable tool on the operations MCP. Pre-check: uncommitted changes → prompt, no tag; clean → the platform pushes the current branch, tags, builds the fixed SHA, runs a migration against the production DB that must stay compatible with the serving slot (destructive ones only in a maintenance window), and deploys to the standby (preview) slot, visible to project members and designated testers. The owner then switches traffic; rollback switches back. Branch choice is the developer's, picked from a dropdown that shows each branch's lag behind both slots.

### Internal APIs and events
Administrators integrate company systems as API proxy projects (blue/green like any service); released proxies register operations keyed by proxy name + method + path, routed by the `/api/<proxy>/` prefix, marked default-open or targeted-open (business requests, administrator approves or rejects with a reason). The gateway evaluates the per-service allow-list locally; proxies are pure forwarders with credentials issued on demand by cs-auth; resource-level scope is the upstream's or business's job. Digital workers may register their own APIs in the same catalog. Swagger is server-side pruned and embedded in the workbench; dev-time test calls go out through the dev container so the gateway sees the service's own identity. Company webhooks enter via the service domain into EventProducer projects (the built-in GitLab-format one is auto-created as a platform project by the installer; a reference APIProxy against the local test GitLab ships too) and into `cs-events`, which dedups, persists and pushes over the service domain with a source token and trace_id to the handler path of the ACTIVE prod slot only. Egress from task containers and builds goes through an FQDN egress proxy with an admin-maintained allowlist; blocked requests are visible in the workbench. No business-published custom events and no platform scheduler in v1.

### Data, config and operations
Each service has one production DataResource set shared by both slots and one development DB for dev sessions, independent of releases. Dev sessions reach data through TaskDataBinding in three modes: `development` (default), `diagnostic-readonly`, `production-change`; the latter two are approved by the project owner and, once approved, are usable by every process in the session container (accepted risk). Config and secrets are platform objects declared in the Manifest `env` section with development and production value sets (production maintained by the owner), injected as env vars and versioned in the Release. Logs are aggregated with a workbench log page; deployment health and project-level alert subscriptions exist (channel still open, Q20). Service plans, replicas and task container profiles are declared in the Manifest from admin-defined plans.

### Traceability
Every task has a platform traceId generated at task creation (or inherited from the triggering event delivery): one taskId ↔ one execution chain, many executions, each agent execution recorded by sessionId and indexable from the traceId. OpenTelemetry covers frontend interaction and is linked via `otel_trace_id` only when a frontend request triggers a task. Knowledge extraction is deliberately out of scope; the data model must not preclude it.

### Code reuse
The copy unit from `~/dev/proj/agent-workflow` (Bun 1.4 + TypeScript, Hono, Drizzle) is: the `RuntimeDriver` drivers under `packages/backend/src/services/runtime/`, `execution/agentInjection`, `agentProcess` and `managedProcess`, and the Agent/Mcp/AgentPermission schemas from `shared`. The DAG orchestration in `runner.ts` is NOT copied; CrewStation writes its own. Do not modify that repository. Two registered deviations from agent-workflow's runtime behavior: dev-session agents run in a streaming interactive mode (both CLIs are one-shot processes there), and Claude Code's built-in sandbox is turned off inside task containers. Public-cloud and internal models are treated identically, as agent-workflow does. The running local `aw-local-gitlab` container (gitlab-ce 19.2.4, HTTP 127.0.0.1:8929, SSH 2222) is the test GitLab; its compose definition is lost and that is a known, deferred gap.

### Module layers and delivery
The 19 modules layer as identity → project → scm/config/data/egress/api-catalog/events/agent-runtime → release/task-runtime → dev-session/business-task/session/gateway → observability/capabilities/provisioning, with `platform` as the composition root that assembles all of them. The domain-free packages are contracts, kernel, persistence, queue, eventbus, http, ws, k8s, gitlab-client, jwt, secretbox, settings, session-client, agent-drivers, api-client and testkit. `runtimes/task` depends only on contracts, kernel, ws and agent-drivers; `apps/console` and `apps/cli` only on contracts and api-client. `tools/arch/policy.ts` holds every one of these allowances, so widening one is a visible, reviewable edit.

Task containers are plain Kubernetes Pods with PVCs in per-project namespaces; no sandbox product, no gVisor or Kata. Milestones: M0 constraints, contracts and prototypes, M1 project, identity, routing and the minimal sample built from its first tag, M2 stateful apps, tag release and blue/green switch plus config and logs, M3 dev session, TaskRunner and workbench, M4 API proxy, open policy, allow-lists, cs-events and egress allowlist, M5 business contract layer, quotas, tracing, alerts and sample acceptance, M6 installer, HA, scale test, upgrades and restore. Scale and HA are verified once, in M6 (accepted risk).
