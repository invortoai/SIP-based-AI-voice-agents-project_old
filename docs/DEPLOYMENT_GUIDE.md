# SIP AI Voice Agents — Consolidated Deployment Guide (AWS + ECS Fargate + OIDC)

Audience and purpose

- Who this is for
  - Executives and non-technical stakeholders: read the Executive summary to understand outcomes, risks, and approvals.
  - Technical operators (DevOps/SRE/Platform): follow the detailed sections for infra provision, CI/CD, and runbooks.
- What this consolidates
  - Supersedes and merges prior guides and notes:
    - [NON_TECH_DEPLOYMENT_GUIDE.md](../NON_TECH_DEPLOYMENT_GUIDE.md:1)
    - [CORE_SERVICES_COMPLETION_SUMMARY.md](../CORE_SERVICES_COMPLETION_SUMMARY.md:1)
    - [docs.PRODUCTION-DEPLOYMENT.md](./PRODUCTION-DEPLOYMENT.md:1)
    - Related operator addenda: [docs.Concurrency-and-Limits.md](./Concurrency-and-Limits.md:1)
- Canonical domains and routes (single-domain model)
  - Production: api.invortoai.com
  - Staging: staging.invortoai.com
  - ALB path routing:
    - /v1/* → API (port 8080)
    - /realtime/*and /v1/realtime/* → Realtime WS (port 8081)
    - /webhooks/* → Webhooks (port 8082)
    - /telephony/* → Telephony (port 8085)
  - Public smoke health endpoint: GET <https://api.invortoai.com/v1/health>
  - Realtime WebSocket endpoint: wss://api.invortoai.com/realtime/voice

-------------------------------------------------------------------------------

1) Executive summary (non-technical)

- What this system does
  - Turns phone or WebSocket audio into real-time assistance via ASR (Deepgram), LLM (OpenAI), and TTS (Deepgram), returning audio back to the caller or browser in a closed loop.
- What is being deployed
  - Four ECS Fargate services behind a single Application Load Balancer (ALB) on AWS:
    - API, Realtime, Webhooks, Telephony
  - Single public domain: api.invortoai.com with path-based routing to services
- How deployments happen
  - GitHub Actions with AWS OIDC (no static AWS keys). Protected, auditable pipeline with security scans (Trivy, tfsec, Semgrep), Terraform validation, and controlled blue/green-style ECS updates.
- Readiness and risk posture
  - Services are production-ready with health checks, metrics, logs, and explicit concurrency limits. A tested rollback procedure is included. Slack notifications are optional.
- What you approve
  - Environment DNS and certificates, concurrency defaults, cost budgets, and the IAM OIDC trust used by CI.

-------------------------------------------------------------------------------

2) Environment overview and prerequisites

Domains and environments

- Production: api.invortoai.com
- Staging: staging.invortoai.com

Prerequisites

- AWS:
  - Account with permissions to create IAM roles, ECR, ECS, ALB, ACM, Route 53 records, S3, and DynamoDB (for Terraform backend)
  - Region: us-east-1
- CI/CD:
  - GitHub repository with Actions enabled
  - AWS OIDC role to assume in CI (no static AWS keys)
- Local tooling (operators):
  - Terraform >= 1.7.5, AWS CLI, jq
- Vendors and secrets:
  - Deepgram (ASR + TTS) keys, OpenAI key
  - Jambonz or telephony provider secrets if Telephony is used

Key references

- CI pipeline: [.github.workflows.ci.yml](../.github/workflows/ci.yml:1)
- Services:
  - [services.api.index()](../services/api/src/index.ts:1)
  - [services.realtime.index()](../services/realtime/src/index.ts:1)
  - [services.webhooks.index()](../services/webhooks/src/index.ts:1)
  - [services.telephony.index()](../services/telephony/src/index.ts:1)
- Concurrency controls: [docs.Concurrency-and-Limits.md](./Concurrency-and-Limits.md:1)

-------------------------------------------------------------------------------

3) Infrastructure provisioning (Terraform, ALB, ECS, OIDC)

High-level topology

- Single ALB (80/443) in public subnets, ECS services in private subnets, NAT per AZ for egress.
- Listener rules forward by path to service target groups.
- Target group health checks: GET /health (interval 15s, timeout 5s, healthy 2, unhealthy 3).

Terraform backend and modules (S3 + DynamoDB)

- Create S3 bucket (versioning, encryption, public access block) and DynamoDB lock table for Terraform state.
- Use envs per environment; see the production runbook for exact commands.
- Example module roots:
  - VPC, subnets, NAT, security groups
  - ALB, listeners, target groups, rules
  - ECS cluster and IAM roles
  - ECR repositories and lifecycle policies
- Validate and plan in CI (see pipeline job “Terraform validate/plan/outputs”).

GitHub Actions OIDC (no static keys)

- Create an IAM OIDC provider for token.actions.githubusercontent.com with current GitHub thumbprints.
- Create an IAM role scoped to:
  - ECR (push/pull), ECS (describe/register/update service), CloudWatch Logs
  - Optional: S3/DynamoDB for Terraform backend access during CI validation
- Add its ARN as GitHub repository secret AWS_OIDC_ROLE_ARN.
- Assumed by jobs in:
  - [.github.workflows.ci.yml](../.github/workflows/ci.yml:1)

-------------------------------------------------------------------------------

4) Core services readiness and completion criteria

Service quick status (from the completion summary)

- API: 100% — REST endpoints for agents, calls, artifacts; health, metrics, rate/usage guards
- Realtime: 90%+ — WebSocket with auth, jitter buffer, energy meter, timeline and tool integration, health/metrics
- Webhooks: 100% — Dispatch, retries, DLQ, HMAC signatures, metrics
- Telephony: 100% — Jambonz webhook integration, concurrency enforcement site, call status, health/metrics

Public endpoints

- Public health for smoke via ALB: GET <https://api.invortoai.com/v1/health>
- Realtime WS: wss://api.invortoai.com/realtime/voice
- API samples:
  - POST <https://api.invortoai.com/v1/agents>
  - GET <https://api.invortoai.com/v1/calls/{id}/timeline>

Internal ALB target health checks

- Each service responds to GET /health (200) on its container port (8080/8081/8082/8085). These are used by target groups and are distinct from the public smoke path of /v1/health.

Concurrency defaults (approved)

- GLOBAL=10000, PER_CAMPAIGN=100, TTL=600, API guard MAX_CONCURRENT_CALLS=200
- See detailed operator notes: [docs.Concurrency-and-Limits.md](./Concurrency-and-Limits.md:1)

-------------------------------------------------------------------------------

5) Application build and release (CI/CD)

Source of truth: [.github.workflows.ci.yml](../.github/workflows/ci.yml:1)

Key pipeline behaviors

- Lint and typecheck
  - Lint failures fail the job (no “|| true”)
- Tests
  - Jest runs with “--runInBand --detectOpenHandles”
  - Database and Redis services started for unit/integration tests
- Terraform validate/plan
  - Assumes AWS OIDC role to access remote backend if configured
  - Uploads artifacts: plan.txt, outputs.json
- Security scanning
  - Trivy filesystem scan (HIGH/CRITICAL gated) with SARIF upload
  - tfsec for Terraform
  - Semgrep SAST; SARIF upload is gated by file existence to avoid false negatives
  - npm audit (non-blocking)
- Build and push
  - Matrix across services: api, realtime, webhooks, telephony
  - Pushes SHA and latest tags to ECR
- Deploy staging (develop branch)
  - Updates ECS services in the invorto-staging cluster
  - Waits for services-stable
- Deploy production (main branch)
  - Blue/green style via new task definition registration and service update
  - Injects environment variables for the single-domain routing model
  - Waits for services-stable
  - Smoke tests:
    - curl -f <https://api.invortoai.com/v1/health>
- Optional notifications
  - Slack step runs only if SLACK_WEBHOOK is set

Environment variables injected at deploy (production)

- PUBLIC_BASE_URL=<https://api.invortoai.com>
- API_BASE_URL=<https://api.invortoai.com/v1>
- REALTIME_WS_URL=wss://api.invortoai.com/realtime/voice
- WEBHOOK_BASE_URL=<https://api.invortoai.com/webhooks>
- TELEPHONY_WEBHOOK_BASE_URL=<https://api.invortoai.com/telephony>

Performance tests (k6)

- Staging job is conditioned on branch and further gated by presence of tests/performance/*.js and K6_CLOUD_TOKEN.
- See tests/load or tests/performance assets for your repository.

Slack notifications

- Optional; gated by the presence of SLACK_WEBHOOK secret. Pipeline succeeds without it.

-------------------------------------------------------------------------------

6) Environment-specific deployment steps

Development (local)

- docker compose up -d for Postgres and Redis
- Run services locally:
  - [services.api.index()](../services/api/src/index.ts:1)
  - [services.realtime.index()](../services/realtime/src/index.ts:1)
  - [services.webhooks.index()](../services/webhooks/src/index.ts:1)
  - [services.telephony.index()](../services/telephony/src/index.ts:1)
- Local health checks:
  - <http://localhost:8080/health> (API)
  - <http://localhost:8081/health> (Realtime)
  - <http://localhost:8082/health> (Webhooks)
  - <http://localhost:8085/health> (Telephony)
- Local Realtime WS example:
  - ws://localhost:8081/realtime/voice

Staging (branch: develop, domain: staging.invortoai.com)

- Push to develop triggers CI:
  - Builds images, deploys ECS services in invorto-staging
  - Waits for services-stable
- Smoke:
  - curl -f <https://staging.invortoai.com/v1/health>
  - Realtime: wss://staging.invortoai.com/realtime/voice

Production (branch: main, domain: api.invortoai.com)

- Push to main triggers CI:
  - Blue/green deploy: register new task definitions, update ECS, wait stable
- Smoke:
  - curl -f <https://api.invortoai.com/v1/health>
  - Realtime: wss://api.invortoai.com/realtime/voice

-------------------------------------------------------------------------------

7) Validations mapped to CI (smoke, performance, security)

Smoke validation

- Public endpoint:
  - curl -f <https://api.invortoai.com/v1/health>
- Service target health (operators):
  - ALB target group health checks (GET /health) via AWS Console or CLI

Realtime connectivity (quick)

- With wscat:
  - wscat -c "wss://api.invortoai.com/realtime/voice?callId=smoke-1" -s "YOUR_REALTIME_API_KEY"

Performance validation (k6)

- CI staging job optionally runs k6 if:
  - K6_CLOUD_TOKEN is configured
  - Performance scripts exist (e.g., tests/performance/*.js)
- Otherwise, run manually against staging with representative load before production cut-up.

Security validation

- Trivy (gated on HIGH/CRITICAL)
- tfsec (Terraform IaC scan)
- Semgrep SAST (SARIF gating on file existence)
- npm audit (non-blocking)

-------------------------------------------------------------------------------

8.Rollback and disaster recovery (DR)

Automatic rollback

- ECS deployment circuit breaker enabled: failed deploys auto-rollback.

Manual rollback

- Revert to the previous task definition revision:
  - See example commands in the production runbook: [docs.PRODUCTION-DEPLOYMENT.md](./PRODUCTION-DEPLOYMENT.md:1)

DR considerations

- Terraform state: S3 with versioning, DDB locks
- Image retention: ECR lifecycle retains latest images
- Backups:
  - Database and object storage backups per your infra policy
- Cross-region DR:
  - Optional replication strategy for critical data

-------------------------------------------------------------------------------

9) Observability and runbooks

Metrics and logs

- Prometheus-style metrics on each service: /metrics
- CloudWatch Log Groups per service (prefix /ecs/…)
- Common runbooks:
  - Elevated 5xx rates → inspect ECS events, ALB target health, and application logs
  - Realtime issues → check /metrics and logs on Realtime, confirm WS auth and Redis availability
  - Webhook backlog → inspect queue depth and DLQ in Webhooks; scale workers or address downstream failures
  - Telephony throttling → confirm concurrency envs and Redis TTL release behavior

Alerts (examples)

- ECS CPU/Memory high
- ALB 5xx sustained
- Unhealthy target counts
- Budget/cost anomalies

-------------------------------------------------------------------------------

10) Appendix — mapping from prior documents

This guide consolidates and supersedes overlapping topics from:

- [NON_TECH_DEPLOYMENT_GUIDE.md](../NON_TECH_DEPLOYMENT_GUIDE.md)
  - Keep for introductory context; deployment sections are superseded here.
- [CORE_SERVICES_COMPLETION_SUMMARY.md](../CORE_SERVICES_COMPLETION_SUMMARY.md:1)
  - Service readiness summarized above; detailed completion notes remain as project status history.
- [docs.PRODUCTION-DEPLOYMENT.md](./PRODUCTION-DEPLOYMENT.md)
  - Production step-by-step is expanded and aligned to the current pipeline; use it for live operations.
- [docs.Concurrency-and-Limits.md](./Concurrency-and-Limits.md)
  - Concurrency defaults and operator tuning remain authoritative and are cross-linked here.

All URLs and endpoints here reflect the latest CI and infra:

- Production domain: api.invortoai.com
- Staging domain: staging.invortoai.com
- Public smoke: GET /v1/health
- Realtime WS: wss://api.invortoai.com/realtime/voice
