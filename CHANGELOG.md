# Changelog

All notable changes to this repository will be documented here.

Format: Keep/Changelog style with concise sections. Dates are in YYYY-MM-DD.

## [Unreleased]

### Added
- Production Deployment Runbook with AWS OIDC and Terraform/ECS workflows:
  - [docs.PRODUCTION-DEPLOYMENT.md](docs/PRODUCTION-DEPLOYMENT.md:1) covers:
    - Environment variables and approved defaults (including TELEPHONY_GLOBAL_MAX_CONCURRENCY=10000, TELEPHONY_PER_CAMPAIGN_MAX_CONCURRENCY=100, TELEPHONY_SEMAPHORE_TTL_SEC=600, MAX_CONCURRENT_CALLS=200)
    - Full AWS OIDC setup steps and GitHub secret (AWS_OIDC_ROLE_ARN)
    - Terraform init/validate/plan/apply and ALB/Route53/ACM/ECS validation
    - CI quality gates and dev URL leakage guard
    - End-to-end validation checklist and troubleshooting
- Fastify shutdown hooks parity:
  - API service now closes PG/Redis on onClose: [services.api.index()](services/api/src/index.ts:108)
  - Realtime service now closes TimelinePublisher & webhook Redis on onClose and SIGTERM: [services.realtime.index()](services/realtime/src/index.ts:299), [services.realtime.index()](services/realtime/src/index.ts:682)
  - Webhooks service now closes Redis on onClose and SIGTERM: [services.webhooks.index()](services/webhooks/src/index.ts:686)
- SDK URL override and precedence docs in README:
  - Explicit Node/Browser defaults and precedence with examples (REALTIME_WS_URL and API_BASE_URL)
  - Links to Concurrency and Production Deployment docs
- Timeline unit tests for XRANGE mapping, ordering, COUNT, and empty streams:
  - [tests.unit.timeline()](tests/unit/timeline.test.ts:1)
- CI dev URL leakage guard to prevent accidental localhost/dev URLs in production code paths:
  - [ci.yml](.github/workflows/ci.yml:29)

### Changed
- Shared WebSocket message schema widened to accept multiple encodings for tts.chunk and added server→client messages connected/pong/error:
  - [packages.shared.messages()](packages/shared/src/messages.ts:59)
- Browser SDK built artifact corrected to default wss://api.invortoai.com/realtime/voice and /realtime/voice URL assembly:
  - [sdk.browser.dist.realtime-client()](sdk/browser/dist/realtime-client.js:8)

### Tests
- Integration tests for SDK realtime connectivity:
  - Node SDK: [tests.integration.node-sdk-realtime()](tests/integration/node-sdk-realtime.test.ts:1)
  - Browser SDK (ws polyfill): [tests.integration.browser-sdk-realtime()](tests/integration/browser-sdk-realtime.test.ts:1)
- SDK URL selection tests (override precedence and ws(s) scheme):
  - [tests.unit.sdk-url-defaults()](tests/unit/sdk-url-defaults.test.ts:1)
- SDK zod validation tests for malformed payloads and TTS encodings:
  - [tests.unit.sdk-validation()](tests/unit/sdk-validation.test.ts:1)

### CI/CD
- OIDC-ready workflows for build/deploy (requires AWS_OIDC_ROLE_ARN secret)
- Terraform validation and plan job that uploads plan.txt and outputs.json artifacts
- Security scanners (Trivy gated on HIGH/CRITICAL, tfsec, Semgrep) and CodeQL maintained

### Notes
- Please configure AWS OIDC before production deploys. See [docs.PRODUCTION-DEPLOYMENT.md](docs/PRODUCTION-DEPLOYMENT.md:1).
- Ensure branch protection requires test/lint/terraform-validate/security-scan/codeql/hadolint/build.
