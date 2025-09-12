# Project To‑Do (Production Readiness)

This checklist tracks remaining work and recent follow‑ups, grouped by area. Each task includes: Title, Why, References, Priority, Status, Owner, and Acceptance Criteria.

Note on links/references

- File references are clickable in the required format, for example: [services.api.index()](services/api/src/index.ts:1), [services.realtime.index()](services/realtime/src/index.ts:1), [docs.Concurrency-and-Limits.md](docs/Concurrency-and-Limits.md:1).
- Language constructs are referenced using a function-like notation in brackets as required, for example: [TimelinePublisher.getEvents()](services/realtime/src/timeline/redis.ts:14).

---

## Documentation

- [ ] Title: Expand Concurrency & Campaign Limits guide to full content
  - Why: Operators need authoritative guidance on caps, envs, validation/tuning, and safety; link enforcement points in code.
  - References: [docs.Concurrency-and-Limits.md](docs/Concurrency-and-Limits.md:1), [services.api.index()](services/api/src/index.ts:238), [services.telephony.index()](services/telephony/src/index.ts:1)
  - Priority: P0
  - Status: Pending
  - Owner: Unassigned
  - Acceptance Criteria:
    - Document global/per-campaign caps, env variables (TELEPHONY_GLOBAL_MAX_CONCURRENCY, TELEPHONY_PER_CAMPAIGN_MAX_CONCURRENCY, TELEPHONY_SEMAPHORE_TTL_SEC, MAX_CONCURRENT_CALLS) with defaults and examples.
    - Include sample capacity calculations and a stepwise validation/tuning procedure.
    - Link each setting to its enforcement site in code (API checks, telephony logic).
    - PR reviewed and merged; link added from README.

- [ ] Title: Expand README SDK URL overrides and env precedence
  - Why: Developers need precise, copy/paste examples and precedence rules for dev vs prod, Node vs Browser.
  - References: [README.md](README.md:1), [sdk.node.realtime-client()](sdk/node/src/realtime-client.ts:89), [sdk.browser.realtime-client()](sdk/browser/src/realtime-client.ts:155)
  - Priority: P0
  - Status: In Progress
  - Owner: Unassigned
  - Acceptance Criteria:
    - Document precedence: Node (REALTIME_WS_URL overrides; else base API → ws(s)+/realtime/voice), Browser (constructor base; default prod WS).
    - Provide examples for REALTIME_WS_URL and API_BASE_URL overrides; dev vs prod matrix.
    - Add snippet showing subprotocol API key usage for both SDKs.
    - CI passes typecheck and lint with updated docs.

- [ ] Title: Document environment variables comprehensively
  - Why: Consolidate REDIS_URL, DB/POSTGRES_URL (DB_URL), REALTIME_WS_URL, PUBLIC_BASE_URL, API_BASE_URL and concurrency variables with defaults.
  - References: [README.md](README.md:238), [services.api.index()](services/api/src/index.ts:60), [services.realtime.index()](services/realtime/src/index.ts:299), [services.webhooks.index()](services/webhooks/src/index.ts:103)
  - Priority: P1
  - Status: Pending
  - Owner: Unassigned
  - Acceptance Criteria:
    - Add a table or section in README enumerating key env vars with descriptions/defaults.
    - Cross-link to [docs.Concurrency-and-Limits.md](docs/Concurrency-and-Limits.md:1).
    - Verify .env.example alignment; CI doc check passes.

- [ ] Title: CHANGELOG.md for shutdown hooks, docs, and SDK guidance
  - Why: Track notable changes for release notes and auditing.
  - References: [services.api.index()](services/api/src/index.ts:108), [services.realtime.index()](services/realtime/src/index.ts:299), [README.md](README.md:1)
  - Priority: P1
  - Status: Pending
  - Owner: Unassigned
  - Acceptance Criteria:
    - Add entries for onClose hooks, schema parity, SDK URL override docs, new tests and CI gates.
    - Lint passes; CHANGELOG committed.

---

## Testing

- [x] Title: Browser SDK realtime integration test (complete and passing)
  - Why: Verify connect → start → receive connected with ws polyfill and subprotocol API key.
  - References: [tests.integration.browser-sdk-realtime()](tests/integration/browser-sdk-realtime.test.ts:1), [services.realtime.index()](services/realtime/src/index.ts:545)
  - Priority: P0
  - Status: Completed
  - Owner: Unassigned
  - Acceptance Criteria:
    - Test boots Fastify on ephemeral port, sets global.WebSocket=ws, connects via Browser SDK using API key subprotocol and asserts t=connected with callId.
    - Passes in CI on main and PRs.

- [ ] Title: Integration tests for graceful shutdown/resource cleanup across services
  - Why: Prevent test hangs and ensure clean shutdown in production; validate onClose hooks and SIGTERM handlers.
  - References: [services.api.index()](services/api/src/index.ts:108), [services.realtime.index()](services/realtime/src/index.ts:682), [services.webhooks.index()](services/webhooks/src/index.ts:686)
  - Priority: P1
  - Status: Pending
  - Owner: Unassigned
  - Acceptance Criteria:
    - Add tests that start each service, then app.close() and assert processes exit without open handles.
    - Run npx jest --runInBand --detectOpenHandles and verify no warnings.
    - CI passes consistently.

- [ ] Title: Unit tests for [TimelinePublisher.getEvents()](services/realtime/src/timeline/redis.ts:14)
  - Why: Ensure correct serialization, ordering (XRANGE ascending), COUNT semantics, and pagination mapping.
  - References: [services.realtime.timeline.TimelinePublisher.getEvents()](services/realtime/src/timeline/redis.ts:14)
  - Priority: P1
  - Status: Pending
  - Owner: Unassigned
  - Acceptance Criteria:
    - Mock Redis XRANGE responses; assert mapping to {id, kind, payload, timestamp}.
    - Test COUNT behavior and ordering; add pagination tests (simulate multiple ranges).
    - Coverage reports include these tests; CI passes.

- [x] Title: URL selection tests for SDKs (Node & Browser)
  - Why: Lock behavior for REALTIME_WS_URL precedence and ws(s)+/realtime/voice derivation; prevent regressions.
  - References: [tests.unit.sdk-url-defaults()](tests/unit/sdk-url-defaults.test.ts:1)
  - Priority: P0
  - Status: Completed
  - Owner: Unassigned
  - Acceptance Criteria:
    - All cases covered and passing under CI.

- [x] Title: SDK zod guard tests for invalid outbound messages and TTS encodings
  - Why: Ensure invalid payloads surface errors but do not crash consumers.
  - References: [tests.unit.sdk-validation()](tests/unit/sdk-validation.test.ts:1), [sdk.node.realtime-client()](sdk/node/src/realtime-client.ts:40), [sdk.browser.realtime-client()](sdk/browser/src/realtime-client.ts:80)
  - Priority: P1
  - Status: Completed
  - Owner: Unassigned
  - Acceptance Criteria:
    - Tests pass for invalid stt/tts/emotion payloads; base64/number[]/Uint8Array accepted for pcm16.

---

## Runtime and Resources

- [x] Title: API service onClose hook closes PG/Redis
  - Why: Eliminate open handle leaks in tests and ensure graceful shutdown.
  - References: [services.api.index()](services/api/src/index.ts:108)
  - Priority: P0
  - Status: Completed
  - Owner: Unassigned
  - Acceptance Criteria:
    - detectOpenHandles exits cleanly; no warnings in CI.

- [x] Title: Realtime service closes timeline and Redis queue clients on shutdown
  - Why: Prevent resource leaks and stuck Redis connections.
  - References: [services.realtime.index()](services/realtime/src/index.ts:299), [TimelinePublisher.close()](services/realtime/src/timeline/redis.ts:14)
  - Priority: P0
  - Status: Completed
  - Owner: Unassigned
  - Acceptance Criteria:
    - detectOpenHandles exits cleanly; connected resources are closed in onClose and SIGTERM.

- [ ] Title: Webhooks service onClose hook to close Redis in addition to SIGTERM
  - Why: Mirror API/Realtime behavior; standardize lifecycle; improve test reliability.
  - References: [services.webhooks.index()](services/webhooks/src/index.ts:686)
  - Priority: P1
  - Status: Pending
  - Owner: Unassigned
  - Acceptance Criteria:
    - Implement app.addHook("onClose") to quit/disconnect Redis.
    - Add/extend integration test to verify clean shutdown; detectOpenHandles has no warnings.

---

## Realtime Timeline

- [x] Title: Add [TimelinePublisher.close()](services/realtime/src/timeline/redis.ts:14) and wire into Fastify onClose
  - Why: Ensure Redis client releases resources gracefully.
  - References: [services.realtime.timeline.TimelinePublisher.close()](services/realtime/src/timeline/redis.ts:14), [services.realtime.index()](services/realtime/src/index.ts:299)
  - Priority: P0
  - Status: Completed
  - Owner: Unassigned
  - Acceptance Criteria:
    - Closing the app invokes close(); no resource leaks observed.

- [ ] Title: Verify getEvents mapping and add pagination/ordering unit tests
  - Why: Prevent schema drift and ensure correct timeline analytics (ascending order, COUNT behavior).
  - References: [services.realtime.timeline.TimelinePublisher.getEvents()](services/realtime/src/timeline/redis.ts:14)
  - Priority: P1
  - Status: Pending
  - Owner: Unassigned
  - Acceptance Criteria:
    - Unit tests assert JSON payload parsing, timestamp numbers, and ascending order; COUNT respected.

- [ ] Title: Expose configurable default COUNT and document
  - Why: Allow callers to tune timeline read batching based on workloads.
  - References: [services.realtime.timeline.TimelinePublisher.getEvents()](services/realtime/src/timeline/redis.ts:14), [docs.Concurrency-and-Limits.md](docs/Concurrency-and-Limits.md:1)
  - Priority: P2
  - Status: Pending
  - Owner: Unassigned
  - Acceptance Criteria:
    - Add optional constructor param or env to set default COUNT; document in README and Concurrency doc; tests added.

---

## SDK and Developer Experience

- [x] Title: Consistent subprotocol API key authentication in SDKs
  - Why: Align auth with server expectations; interoperability for web and node environments.
  - References: [sdk.node.realtime-client.connect()](sdk/node/src/realtime-client.ts:108), [sdk.browser.realtime-client.connect()](sdk/browser/src/realtime-client.ts:162)
  - Priority: P0
  - Status: Completed
  - Owner: Unassigned
  - Acceptance Criteria:
    - Integration tests show both SDKs send API key via subprotocol; pass in CI.

- [x] Title: Production URL defaults and no hardcoded dev endpoints
  - Why: Ensure prod readiness; prevent accidental ws://localhost leaks.
  - References: [sdk.browser.dist.realtime-client()](sdk/browser/dist/realtime-client.js:8), [sdk.node.client()](sdk/node/src/client.ts:30), [sdk.node.realtime-client()](sdk/node/src/realtime-client.ts:89)
  - Priority: P0
  - Status: Completed
  - Owner: Unassigned
  - Acceptance Criteria:
    - Repo-wide search for dev endpoints yields no matches; CI guard added (see CI & Quality Gates).

---

## CI and Quality Gates

- [ ] Title: GitHub Actions OIDC migration, Terraform job, and security gates finalization
  - Why: Remove static AWS keys; enforce infra validation and security scanning.
  - References: [ci.yml](.github/workflows/ci.yml:1)
  - Priority: P0
  - Status: In Progress
  - Owner: Unassigned
  - Acceptance Criteria:
    - AWS_OIDC_ROLE_ARN secret configured; build/deploy jobs assume role successfully; no static key usage.
    - Terraform fmt/validate/plan runs, artifacts (plan.txt, outputs.json) uploaded.
    - Trivy (gated HIGH/CRITICAL), tfsec, Semgrep jobs pass or fail appropriately; required checks configured in branch protection.

- [ ] Title: CI guard for dev URL leakage (localhost/ws://)
  - Why: Prevent accidental introduction of dev URLs into production code.
  - References: [ci.yml](.github/workflows/ci.yml:1)
  - Priority: P0
  - Status: Pending
  - Owner: Unassigned
  - Acceptance Criteria:
    - Add a job step to grep for patterns: (localhost|ws://(?!127.0.0.1)|<http://localhost|api\.invorto\.ai(?!\.com)>); fail on match except under tests.
    - Document rule in README; job runs on PRs and main.

- [ ] Title: Fix any path/tooling issues for cross-platform file references in docs/tests
  - Why: Ensure references in docs and tooling consistently resolve (avoid Windows path confusion).
  - References: [README.md](README.md:1), [docs.Concurrency-and-Limits.md](docs/Concurrency-and-Limits.md:1)
  - Priority: P2
  - Status: Pending
  - Owner: Unassigned
  - Acceptance Criteria:
    - Standardize references to forward-slash POSIX paths in docs and tests.
    - Spot-check that documentation links resolve in rendered contexts and that repository tools can read referenced files.

---

## Housekeeping

- [ ] Title: Assign owners for P0/P1 items and add due dates
  - Why: Improve throughput and accountability.
  - References: [docs.TODO.md](docs/TODO.md:1)
  - Priority: P1
  - Status: Pending
  - Owner: Unassigned
  - Acceptance Criteria:
    - Owners and due dates added for all P0/P1 tasks; list updated.

- [ ] Title: PR packaging and release notes
  - Why: Provide artifacts and documentation for the release.
  - References: [ci.yml](.github/workflows/ci.yml:100), [README.md](README.md:1), [CHANGELOG.md](CHANGELOG.md:1)
  - Priority: P2
  - Status: Pending
  - Owner: Unassigned
  - Acceptance Criteria:
    - Include Terraform plan outputs, coverage, SARIF scanner outputs; conventional commits in PR; release notes drafted.
