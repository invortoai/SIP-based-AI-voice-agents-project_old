# SIP AI Voice Agents — Production Deployment Runbook (AWS + ECS Fargate + OIDC)

This is the authoritative, step‑by‑step production runbook aligned with the current CI workflow and single‑domain ALB routing.

- Canonical domains:
  - Production: <https://api.invortoai.com>
  - Staging: <https://staging.invortoai.com>
- Public smoke health: GET <https://api.invortoai.com/v1/health>
- Realtime WebSocket: wss://api.invortoai.com/realtime/voice
- CI pipeline source of truth: [.github/workflows/ci.yml](../.github/workflows/ci.yml)

-------------------------------------------------------------------------------

## 0. Pre‑deployment gates and approvals

Required checks in CI (branch protection)

- Lint and Type Check jobs pass (linter must fail on violations — no “|| true”)
- Tests job passes (Jest runs with --runInBand --detectOpenHandles)
- Terraform validate/plan job passes and uploads artifacts (plan.txt, outputs.json)
- Security scans:
  - Trivy filesystem scan (HIGH/CRITICAL) — gated
  - tfsec (Terraform IaC) — must pass
  - Semgrep SAST — SARIF upload runs only if a file is produced
  - npm audit (non‑blocking)
- Build images for api, realtime, webhooks, telephony
- Deploy job (staging or production) completes services‑stable waits

Approvals and environment configuration

- OIDC: AWS role configured and added as GitHub secret AWS_OIDC_ROLE_ARN (see [docs.DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md))
- Slack notifications: optional — set SLACK_WEBHOOK to enable, otherwise auto‑skipped
- k6 performance tests (staging): optional — set K6_CLOUD_TOKEN and ensure tests/performance/*.js exist

-------------------------------------------------------------------------------

## 1. Environment and routing model

Single ALB, path‑based routing:

- /v1/* → API (port 8080)
- /realtime/*and /v1/realtime/* → Realtime WS (port 8081)
- /webhooks/* → Webhooks (port 8082)
- /telephony/* → Telephony (port 8085)

Public smoke health

- GET <https://api.invortoai.com/v1/health>

Internal container health (ALB target checks)

- GET /health on each service container (200 OK), interval 15s, timeout 5s, healthy 2, unhealthy 3

-------------------------------------------------------------------------------

## 2) Required secrets and environment variables

Configured via ECS Task Definitions and CI deploy job (injected at production deploy)

- PUBLIC_BASE_URL=<https://api.invortoai.com>
- API_BASE_URL=<https://api.invortoai.com/v1>
- REALTIME_WS_URL=wss://api.invortoai.com/realtime/voice
- WEBHOOK_BASE_URL=<https://api.invortoai.com/webhooks>
- TELEPHONY_WEBHOOK_BASE_URL=<https://api.invortoai.com/telephony>

Concurrency defaults (production)

- TELEPHONY_GLOBAL_MAX_CONCURRENCY=10000
- TELEPHONY_PER_CAMPAIGN_MAX_CONCURRENCY=100
- TELEPHONY_SEMAPHORE_TTL_SEC=600
- MAX_CONCURRENT_CALLS=200

Sensitive values (store in SSM/Secrets Manager and wire into task definitions)

- DB_URL (SSM SecureString)
- REDIS_URL (SSM SecureString)
- REALTIME_API_KEY (SSM) and optionally REALTIME_WS_SECRET (SSM)
- JAMBONZ_* (if Telephony outcall/origination is used)

References:

- Services code: [services.api.index()](../services/api/src/index.ts:1), [services.realtime.index()](../services/realtime/src/index.ts:1), [services.webhooks.index()](../services/webhooks/src/index.ts:1), [services.telephony.index()](../services/telephony/src/index.ts:1)
- Concurrency guide: [docs.Concurrency-and-Limits.md](./Concurrency-and-Limits.md:1)

-------------------------------------------------------------------------------

## 3) Build and artifacts

Trigger

- Push/merge to main (production) or develop (staging) runs the CI defined in [.github.workflows.ci.yml](../.github/workflows/ci.yml)

Artifacts produced by CI

- Docker images (ECR) tagged with ${GITHUB_SHA} and latest for each service:
  - invorto-api, invorto-realtime, invorto-webhooks, invorto-telephony
- Terraform artifacts:
  - infra/terraform/plan.txt
  - infra/terraform/outputs.json
- SARIF scan outputs:
  - Trivy FS (always produced, gated)
  - Semgrep (uploaded only if semgrep.sarif exists)

-------------------------------------------------------------------------------

## 4) Production deployment (automated via CI)

Branch: main

- OIDC role assumed; ECR login
- Update services with new Task Definitions (image replacement + env injection shown above)
- ECS waits for services‑stable
- Smoke test:
  - curl -f <https://api.invortoai.com/v1/health>

No manual action is required if CI is green. For visibility, check:

- ECS services events (invorto-production cluster)
- ALB target health for each target group (api, realtime, webhooks, telephony)
- CloudWatch logs for new task revisions

-------------------------------------------------------------------------------

## 5) Staging deployment (pre‑production)

Branch: develop

- Same flow as production, but targeting the staging cluster (invorto-staging)
- Smoke test:
  - curl -f <https://staging.invortoai.com/v1/health>
- Optional: performance test (k6)
  - Executed by CI if both K6_CLOUD_TOKEN is set and tests/performance/*.js exist
  - Otherwise run locally against staging prior to increasing traffic

-------------------------------------------------------------------------------

## 6) Post‑deploy validations

A) Smoke and routing checks (copy/paste)

```bash
# Production
curl -fsS https://api.invortoai.com/v1/health

# Realtime WS (requires wscat with API key as subprotocol)
wscat -c "wss://api.invortoai.com/realtime/voice?callId=canary-1" -s "YOUR_REALTIME_API_KEY"
# Then send a minimal start message:
# {"t":"start","callId":"canary-1","agentId":"canary-agent"}
```

B) API exercises (production)

```bash
# Create agent
curl -fsS -X POST https://api.invortoai.com/v1/agents \
  -H "Content-Type: application/json" \
  -d '{"name":"Prod Canary Agent","config":{"prompt":"You are a helpful agent."}}'

# List calls (should return 200 even if empty)
curl -fsS https://api.invortoai.com/v1/calls
```

C) Target health

- Verify ALB target groups report healthy hosts for all four services
- ECS services in “steady state” with desiredCount met

D) Observability

- Metrics: GET /metrics on each service (via private access or port‑forward)
- Logs: CloudWatch log groups per service prefix /ecs/invorto-* (look for error spikes)

-------------------------------------------------------------------------------

## 7. Performance validation (k6)

CI‑driven (staging)

- k6 job is conditioned on branch=develop and is further gated by:
  - Presence of tests/performance/*.js
  - Non‑empty K6_CLOUD_TOKEN secret
- If gates are unmet, run k6 locally against staging before promoting

Local example (adjust as needed)

```bash
# Using a repo script or k6 directly (example path)
k6 run tests/load/k6-load-test.js \
  -e API_URL=https://staging.invortoai.com \
  -e WS_URL=wss://staging.invortoai.com/realtime/voice
```

-------------------------------------------------------------------------------

## 8) Security validation

CI steps (see [.github.workflows.ci.yml](../.github/workflows/ci.yml))

- Trivy FS (gated HIGH/CRITICAL severities) — produces trivy-fs.sarif and fails on findings
- tfsec (Terraform IaC) — fails on violations in infra/terraform
- Semgrep SAST — runs with p/ci ruleset; SARIF upload occurs only if semgrep.sarif is produced
- npm audit — non‑blocking; review report and open tickets if needed

-------------------------------------------------------------------------------

## 9) Rollback procedures

ECS deployment circuit breaker

- Enabled; failed deploys should auto‑rollback

Manual rollback to previous task definition (example for API)

```bash
# List recent task definitions
aws ecs list-task-definitions --family-prefix invorto-api --sort DESC --region us-east-1 | head -n 5

# Pin service back to a known-good revision
aws ecs update-service \
  --cluster invorto-production \
  --service invorto-api \
  --task-definition arn:aws:ecs:us-east-1:ACCOUNT_ID:task-definition/invorto-api:<REVISION> \
  --force-new-deployment \
  --region us-east-1
```

When to rollback

- Health fails or error rates spike beyond thresholds (5xx sustained, ALB UnHealthyHostCount > 0)
- Canary WS/connectivity breaks or latency/SLOs regress
- Trivy/tfsec report new HIGH/CRITICAL on the deployed image(s)

Additional controls

- Temporarily disable deploys by tightening OIDC trust (role conditions) if needed
- Reduce desiredCount to known‑good stable level while investigating

-------------------------------------------------------------------------------

## 10) Notifications (Slack) — optional

- Slack step runs only when SLACK_WEBHOOK is configured in repository secrets
- If not configured, notification step is skipped and deployments proceed normally

-------------------------------------------------------------------------------

## 11) Appendix — operator references

- Consolidated guide: [docs.DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)
- Concurrency defaults and tuning: [docs.Concurrency-and-Limits.md](./Concurrency-and-Limits.md:1)
- Services entrypoints:
  - [services.api.index()](../services/api/src/index.ts:1)
  - [services.realtime.index()](../services/realtime/src/index.ts:1)
  - [services.webhooks.index()](../services/webhooks/src/index.ts:1)
  - [services.telephony.index()](../services/telephony/src/index.ts:1)
- CI workflow file: [.github.workflows.ci.yml](../.github/workflows/ci.yml)
