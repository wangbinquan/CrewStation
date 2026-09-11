# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository status

CrewStation (数字人能力平台: a platform on which teams build, publish and run "digital worker" business apps with coding agents) is at the proposal stage. The repository holds Chinese-language design documents under `proposal/` plus two source essays by the author. There is no source code, package manifest, lockfile, CI, or test suite.

Everything the documents describe (`cs-*` services, platform APIs, the Manifest, state machines, the `crewstation install|upgrade|status|verify` CLI) is a *proposed* contract, not an existing one. Do not describe any of it as implemented, verified, or company-approved.

**Version state (2026-09-11):** all three documents are v0.3.1 and consistent. `proposal/tech-evaluation.md` (1.0.0) records the confirmed technology choices E01–E22 with their still-unverified points; Proposal §8 and Design §3.1 carry the same conclusions. Exact versions are not locked until Plan T0.2, and everything remains a proposal until M0 prototypes verify it.

## Commands

None exist yet. The confirmed stack is TypeScript on Bun with Bun workspaces, Hono, zod and Drizzle (see `proposal/tech-evaluation.md`), so expect `bun install` and `bun test` style commands once code lands; replace this section with the real ones then. The `crewstation …` commands in Design §11–12 are the future product CLI, not developer tooling.

## The three documents

| File | Answers | Owns (v0.3.0 numbering for Proposal) |
|---|---|---|
| `proposal/proposal.md` | Why, what, and what not | Sources S1–S8 (§0.1), change tables per version (§0.2), positioning (§2), **capability panorama and integration conventions (§3)**, product principles (§4), scenarios A–F (§5), **requirement baseline R01–R49 (§6)**, scope limits (§7), stack candidates marked 待重评 (§8) |
| `proposal/design.md` | Objects, interfaces, runtime and data mechanisms | 18 invariants (§1.1), core objects (§1.2), deployment entities (§2), confirmed stack and adapter boundaries (§3), three Manifest kinds / persistence / API (§4), dev session and TaskRunner (§5), tag release (§6), identity and roles (§7), API proxy, open policy and cs-events (§8), data (§9), task containers and business subtask contract (§10), install and upgrade (§11–12), traceability (§14), **decisions D01–D38 (§15.2), open questions Q01–Q19 (§15.3)** |
| `proposal/plan.md` | How requirements become tasks and evidence | Milestones M0–M6 with gates G0–G6 (renamed in v0.3.0), task rows `Tn.m` kept with 已删除 / 已作废 markers, **acceptance tests AT-01–AT-43 (§10)**, **traceability matrix R01–R49 → Design § → T → AT (§11)**, evidence layout (§12), deferred items (§13) |
| `proposal/tech-evaluation.md` | Which components and why | E01–E22: constraints, analysis, confirmed choice, alternative, what M0 must verify; confirmation log (§5) |

The two essays 《从个人提效到组织提效…》 and 《借鉴微信小程序…》 are the polished form of source S1; they are reference material and are intentionally not listed in the Proposal's source table.

## Conventions when editing the documents

- **Stable, shared identifiers.** R (requirements), S (sources), D (decisions), Q (open questions), `Tn.m` (task m of milestone Mn), G (gates), AT (acceptance tests). Never renumber or reuse a number. A withdrawn item keeps its row with 已删除 or 已作废 plus the replacing numbers (v0.3.0: R06, R20 deleted; R10–R13 superseded by R44–R46). Scenario letters may be re-lettered when one is deleted (v0.3.0 removed old B and shifted C–F to B–E), and every reference must then be updated.
- **Classify every statement.** Proposal uses 已明确要求 / 建议方案 / 待验证事项; Design uses 要求 / 基线 / 条件性选项 / 待决. Tag decisions with their source (S1–S8). Do not promote a suggestion to a requirement without a source or a new user instruction.
- **No invented numbers or results.** Scale figures in the docs (hundreds of digital workers, hundreds of nodes) are stated design targets, never measurements. Do not write latency, RPO/RTO, success rates, or test outcomes that were not measured. AT entries are tests to be written; all tasks start as 未执行.
- **Keep the 目录** at the top of each file in sync with headings, and the three headers' version lines in sync when bumping.
- **Style.** Simplified Chinese prose with English identifiers in backticks; full-width `｜` in the H1, `／` for or/and, `＋` for plus. Cross-document section references use the target document's current numbering.
- **Work with the author by asking, not guessing.** The author confirmed the v0.3.0 decisions round by round; unresolved design points go to them as questions (see the memory notes for this project) rather than being decided unilaterally.

## Terminology (use exactly)

- **数字人** (digital worker): a deployable business service with pages, API, events, DB, files and its own identity. First-version rule: one Project holds one DigitalWorkerService.
- **Two Agent purposes**: 意图创建与修改 Agent (`intent`) develops the app itself inside the dev container; 业务执行 Agent (`business`) is invoked by the business service through the subtask contract layer. There is **no role dimension** (no 主 Agent / coordinator, no 分析 / 编码 / 审核 roles); business subtasks carry only an `agentProfile` and an I/O contract.
- **开发会话**: the user-facing name of an intent TaskEnvironment: one long-lived dev container with a resident TaskRunner, multiple parallel agents, web terminal, editor, preview, publish controls. One project has at most one at a time.
- **接入容器**: admin-built platform projects of Manifest kind `APIProxy` (pure forwarding of company APIs) or `EventProducer` (turns company webhooks into platform events). Built and released like any digital worker.
- **Five resident services**: `cs-api`, `cs-auth` (company login at the gateway, identity injection, workload-identity verification, on-demand upstream credentials), `cs-controller` (task containers, build, release, routing, data provisioning, GitLab management operations), `cs-session` (agent sessions, terminals, file streams), `cs-events` (event distribution center; formerly `cs-connector`). Plus two platform MCP servers: a capability-description MCP and an operations MCP.
- **Superseded, do not reintroduce:** 主 Agent / coordinator; agent roles; the foreground execution slot and single-writer rule; Checkpoint snapshots; `DevSession` as a separate object; `SandboxLease` for intent tasks; ZIP import; the knowledge flywheel (traceability stays, extraction does not); Docker Compose mode; `auto-after-checks` auto-publish and `code-checkpoint`; `cs-connector` as an API Broker; `RunWorkspaceBinding`; `/v1/agent-runs`.

## Architecture as designed (v0.3.0)

### Scale and platform shape
Design target: the whole company, hundreds of digital-worker services running concurrently on a Kubernetes cluster of hundreds of nodes; one cluster in v1, multi-cluster deferred; control-plane HA is a v1 requirement. Kubernetes only; local validation runs on the docker-desktop kind cluster. Every component choice is evaluated against this target.

### Identity
The gateway authenticates users and injects both trusted plaintext identity headers and a platform-signed token into every request; business services write no login code and own their authorization rules. Services calling internal APIs are identified by Kubernetes workload identity, never by self-reported headers. Platform roles: administrator (integrations, open policy, targeted-API approval), project owner (members, promotion to prod, data-access approval), developer (dev sessions, tagging to preview).

### Execution model
One task = one long-lived container scheduled by the platform, with a resident TaskRunner exposing an API to the control plane (start agent, run command, read files, cancel). Intent tasks get only these primitives: developers start one or more agents in parallel and the platform does not manage workspace sharing, branching, or merging. Business tasks keep the SubtaskRun contract layer (agent/command subtasks, `agentProfile`, I/O contract, attempts, state machine); subtasks may run concurrently, coordinated by the business program. Storage follows the task: intent tasks always use a PV that follows the container and have only running/released states; business tasks may choose a persistent PV with a recreatable container (advanced parameter), which is the only mode with pause/resume. The only v1 budget is a per-digital-worker concurrent-task quota. Preview inside the dev container is auto-started by TaskRunner from the Manifest's development command.

### Source → release
One service ↔ one hosted GitLab-compatible Project, created idempotently at project creation with the minimal sample template (shows the current user and chats with an agent). Publishing is a separate action: only a platform-created `v<major>.<minor>.<patch>` tag triggers a release; manual tags do nothing. Entry points are the workbench publish button and an agent-callable tool on the operations MCP. Pre-check: uncommitted changes → prompt, no tag; clean → the platform pushes the current branch, tags, builds the fixed SHA, deploys to the preview environment; the project owner promotes to prod as a distinct action. Branch choice is the developer's; when opening a dev session they pick the working branch from a dropdown and the UI shows the deployed SHA and how far it lags.

### Internal APIs and events
Administrators integrate company systems as API proxy projects; released proxies register their operations in the catalog, marked default-open (callable by every business) or targeted-open (business requests, administrator approves). The gateway enforces method+path level allow-lists per service; proxies are pure forwarders; resource-level scope is the upstream's or business's job. Digital workers may register their own APIs in the same catalog. Swagger is server-side pruned and embedded in the workbench; dev-time calls use the service's preview grant. Company webhooks enter through EventProducer containers (a GitLab-format one ships and deploys by default) into `cs-events`, which dedups, persists and pushes to the handler path the service declares in its Manifest. No business-published custom events and no platform scheduler in v1.

### Data
DataResource/DataBinding sit at Project + environment level, independent of releases. Dev sessions reach data through TaskDataBinding in three modes: `development` (default), `diagnostic-readonly`, `production-change`; the latter two are approved by the project owner.

### Traceability
Every task has a platform traceId: one taskId ↔ one execution chain, many executions, each agent execution recorded by sessionId and indexable from the traceId. OpenTelemetry covers frontend interaction and is linked only when a frontend request triggers a task. Knowledge extraction is deliberately out of scope; the data model must not preclude it.

### Code reuse
Agent drivers (OpenCode and Claude Code, both required in v1), the code-host client and related pieces are **copied and adapted** from `~/dev/proj/agent-workflow` (Bun 1.4 + TypeScript, Hono, Drizzle; `RuntimeDriver` under `packages/backend/src/services/runtime/`). Do not modify that repository, and run Claude Code exactly the way agent-workflow's driver does, with no special sandbox handling. Public-cloud and internal models are treated identically, as agent-workflow does. The running local `aw-local-gitlab` container (gitlab-ce 19.2.4, HTTP 127.0.0.1:8929, SSH 2222) is the test GitLab; its compose definition is lost and that is a known, deferred gap.

### Planned layout and delivery
Design §15.1 lays out a Bun workspace: `apps/{console,api,auth,controller,session,events}`, `mcp/{capabilities,operations}`, `packages/{contracts,runtime-drivers,code-host,gateway-policy,data-providers}`, `runtimes/task` (the task container image with TaskRunner and both CLIs), `integrations/gitlab-event-producer`, `templates/minimal-sample`, `deploy/{helm,installer,profiles}`, `tests/*`. Task containers are plain Kubernetes Pods with PVCs; no sandbox product, no gVisor or Kata. Milestones: M0 constraints and prototypes (T0.2 locks versions), M1 project, identity, routing and the minimal sample, M2 stateful apps and tag release, M3 dev session, TaskRunner and workbench, M4 API proxy, open policy and cs-events, M5 business contract layer, quotas and sample acceptance, M6 installer, HA, upgrades and restore.
