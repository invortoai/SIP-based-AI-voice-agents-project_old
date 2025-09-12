# Production Deployment Runbook (AWS + Terraform + ECS + GitHub OIDC)

This document provides a complete, step-by-step guide to deploy the “SIP based AI voice agents project” to AWS in a production-ready manner. It includes all environment variables you need, the AWS OIDC configuration for GitHub Actions, Terraform usage, CI gates, and operational validation.

Key references in repo:
- Services and lifecycle:
  - [services.api.index()](../services/api/src/index.ts:1)
  - [services.realtime.index()](../services/realtime/src/index.ts:1)
  - [services.webhooks.index()](../services/webhooks/src/index.ts:1)
  - [services.realtime.timeline.TimelinePublisher.getEvents()](../services/realtime/src/timeline/redis.ts:14)
- SDKs:
  - Node: [sdk.node.client()](../sdk/node/src/client.ts:1), [sdk.node.realtime-client()](../sdk/node/src/realtime-client.ts:1)
  - Browser: [sdk.browser.realtime-client()](../sdk/browser/src/realtime-client.ts:1)
- Infra (Terraform): infra/terraform/*
- CI Workflows:
  - [ci.yml](../.github/workflows/ci.yml:1)
  - [test.yml](../.github/workflows/test.yml:1)

-------------------------------------------------------------------------------

1) Environment variables (what to set)

Use .env and ECS Task Definition environment variables for the following. For initial production, use these defaults unless you have stricter requirements.

Core single-domain endpoints (prod):
- PUBLIC_BASE_URL=https://api.invortoai.com
- API_BASE_URL=https://api.invortoai.com/v1
- REALTIME_WS_URL=wss://api.invortoai.com/realtime/voice
- WEBHOOK_BASE_URL=https://api.invortoai.com/webhooks
- TELEPHONY_WEBHOOK_BASE_URL=https://api.invortoai.com/telephony

Authentication and security:
- REALTIME_API_KEY=your_realtime_api_key_here
- REALTIME_WS_SECRET=your_realtime_ws_hmac_secret (optional HMAC signature for WS)
- JAMBONZ_WEBHOOK_SECRET=shared_secret_with_jambonz

Datastores and infra:
- DB_URL=postgresql://user:password@hostname:5432/invorto   (used by API)
- REDIS_URL=redis://hostname:6379                         (used by Realtime/Webhooks/Workers)

Concurrency and capacity (approved defaults):
- TELEPHONY_GLOBAL_MAX_CONCURRENCY=10000
- TELEPHONY_PER_CAMPAIGN_MAX_CONCURRENCY=100
- TELEPHONY_SEMAPHORE_TTL_SEC=600       (we recommend 10 minutes to reclaim leaked slots)
- MAX_CONCURRENT_CALLS=200              (API-level guard for outbound calls)

Other recommended:
- LOG_LEVEL=info
- ENABLE_METRICS=true
- OTEL_EXPORTER_OTLP_ENDPOINT= (optional)
- JWT_PUBLIC_KEY / JWT_SECRET if JWT auth mode used

Where to put these:
- During local runs: create .env from [.env.example](../.env.example:1) and set the values.
- In production: put them as ECS Task Definition environment variables via Terraform or CI “task-definition” update in [ci.yml](../.github/workflows/ci.yml:229).

-------------------------------------------------------------------------------

2) GitHub Actions with AWS OIDC (no static AWS keys)

Why OIDC:
- Removes long-lived AWS access keys from GitHub
- Uses short-lived STS credentials per workflow
- Easier audit (CloudTrail), least privilege, and branch/repo scoping

Steps in AWS:
1. Ensure an IAM OIDC provider for GitHub exists:
   - Provider URL: https://token.actions.githubusercontent.com
   - Audience: sts.amazonaws.com

2. Create an IAM Role for CI/CD (e.g., invorto-ci):
   - Trust policy allowing GitHub OIDC with conditions restricting your org/repo/branch.
   - Permissions (least-privilege for your pipeline):
     - ECR: ecr:GetAuthorizationToken, ecr:BatchCheckLayerAvailability, ecr:CompleteLayerUpload, ecr:BatchGetImage, ecr:InitiateLayerUpload, ecr:PutImage, ecr:UploadLayerPart
     - ECS: ecs:DescribeServices, ecs:UpdateService, ecs:RegisterTaskDefinition, ecs:DescribeTaskDefinition, ecs:ListServices
     - If Terraform remote state is in S3/DynamoDB: s3:GetObject/PutObject/ListBucket and dynamodb:GetItem/PutItem for the specific backend resources

3. Copy the Role ARN (arn:aws:iam::<account>:role/invorto-ci).

Steps in GitHub:
1. In your repository Settings → Secrets and variables → Actions → New Repository Secret:
   - Name: AWS_OIDC_ROLE_ARN
   - Value: arn:aws:iam::<account>:role/invorto-ci

2. The workflows are already wired to use OIDC:
   - Build job: [ci.yml](../.github/workflows/ci.yml:117)
   - Staging deploy: [ci.yml](../.github/workflows/ci.yml:154)
   - Production deploy: [ci.yml](../.github/workflows/ci.yml:193)

3. Validate:
   - Add a temporary step after configure-aws-credentials to print the caller identity:
     aws sts get-caller-identity
   - Confirm the Arn is your OIDC role (invorto-ci).

-------------------------------------------------------------------------------

3) Terraform workflow (ap-south-1, single ALB, ECS Fargate)

Directories:
- Root: infra/terraform
- Modules: infra/terraform/modules

What it provisions (as per previous context):
- One public ALB with HTTP→HTTPS redirect, 443 TLS listener
- Route53 A/AAAA alias to ALB (api.invortoai.com)
- ECS Fargate cluster + services (api, realtime, webhooks, telephony/workers)
- Path-based routing (ALB):
  - /v1/* → API (default)
  - /realtime/* (and /v1/realtime/* if configured) → Realtime
  - /webhooks/* → Webhooks
  - /telephony/* → Telephony
- Health checks for all services via /health

Commands:
- cd infra/terraform
- terraform init -input=false
- terraform validate
- terraform plan -var="environment=prod" -no-color -out=tfplan
- terraform show -no-color tfplan > plan.txt
- terraform output -json > outputs.json

CI integration:
- The “terraform-validate” job in [ci.yml](../.github/workflows/ci.yml:100) runs fmt/validate/plan and uploads plan.txt and outputs.json artifacts when OIDC is enabled.

ALB/Route53/ACM verification (CLI):
- aws acm list-certificates --region ap-south-1 --query "CertificateSummaryList[?contains(DomainName, 'api.invortoai.com')]"
- aws elbv2 describe-load-balancers --region ap-south-1
- aws elbv2 describe-listeners --listener-arn <443-listener-arn>
- aws elbv2 describe-rules --listener-arn <443-listener-arn>
- aws route53 list-resource-record-sets --hosted-zone-id <ZONE_ID> --query "ResourceRecordSets[?Name==`api.invortoai.com.`]"

-------------------------------------------------------------------------------

4) CI quality gates and URL guard

Workflows:
- Build, lint, typecheck, test: [ci.yml](../.github/workflows/ci.yml:1)
- CodeQL: [codeql.yml](../.github/workflows/codeql.yml:1)
- Hadolint: [hadolint.yml](../.github/workflows/hadolint.yml:1)
- URL guard (to prevent dev URLs in prod code):
  - Add a step in the “test” or “lint-and-typecheck” job:
    name: Check for dev URL leakage
    run: |
      ! git grep -nE "(localhost|http://localhost|ws://(?!127\.0\.0\.1)|api\.invorto\.ai(?!\.com))" -- ':!tests' ':!docker-compose.yml'

Security scanners (recommended thresholds):
- Trivy filesystem scan gated on HIGH/CRITICAL (already wired in [ci.yml](../.github/workflows/ci.yml:286))
- tfsec (Terraform IaC scanning) and Semgrep SAST
- CodeQL analysis on PRs and main

Branch protection:
- Require passing checks: lint/typecheck, test, terraform-validate, security-scan, codeql, hadolint, build

-------------------------------------------------------------------------------

5) ECS deployment and environment propagation

In production deploy step, the workflow updates the container image and injects environment variables in the task definition using jq:
- See [ci.yml](../.github/workflows/ci.yml:229)
- It ensures PUBLIC_BASE_URL, API_BASE_URL, REALTIME_WS_URL, WEBHOOK_BASE_URL, TELEPHONY_WEBHOOK_BASE_URL are set on the container.

Validation of running services (post-deploy smoke tests):
- curl -f https://api.invortoai.com/health
- WebSocket (from workstation):
  - wscat -c "wss://api.invortoai.com/realtime/voice?callId=smoke-1" -s "YOUR_REALTIME_API_KEY"
  - Send: {"t":"start","callId":"smoke-1","agentId":"smoke-agent"}
  - Expect: {"t":"connected","callId":"smoke-1",...}

-------------------------------------------------------------------------------

6) SDK defaults and overrides (dev vs prod)

Node SDK:
- Defaults:
  - Base API: https://api.invortoai.com
  - WS URL: If REALTIME_WS_URL is set, it takes precedence; else base http(s) → ws(s) + /realtime/voice
- Code: [sdk.node.realtime-client()](../sdk/node/src/realtime-client.ts:89)
- Example overrides:
  - REALTIME_WS_URL=wss://staging.example.com/realtime/voice
  - API_BASE_URL=https://staging.example.com/v1

Browser SDK:
- Default WS: wss://api.invortoai.com/realtime/voice
- To override in dev: new RealtimeClient("ws://127.0.0.1:8081")
  - It appends /realtime/voice if missing and adds query params
- Code: [sdk.browser.realtime-client()](../sdk/browser/src/realtime-client.ts:155)

Auth (both SDKs):
- Preferred: subprotocol Sec-WebSocket-Protocol carries the API key
- Fallbacks: ?api_key=... or Authorization: Bearer <token> (server accepts API key in bearer as well)
- Tests:
  - [tests.integration.node-sdk-realtime()](../tests/integration/node-sdk-realtime.test.ts:1)
  - [tests.integration.browser-sdk-realtime()](../tests/integration/browser-sdk-realtime.test.ts:1)

-------------------------------------------------------------------------------

7) Service lifecycle and resource shutdown

All services must close external resources (Redis/Postgres/WS) on shutdown to avoid leaks.

- API: closes PG stub/connection and Redis in onClose
  - [services.api.index()](../services/api/src/index.ts:108)
- Realtime: closes TimelinePublisher (Redis) and webhookQ (Redis) in onClose and SIGTERM
  - [services.realtime.index()](../services/realtime/src/index.ts:299)
  - [services.realtime.index()](../services/realtime/src/index.ts:682)
- Webhooks: onClose + SIGTERM to quit/disconnect Redis (implemented)
  - [services.webhooks.index()](../services/webhooks/src/index.ts:686)

Validation:
- Locally run tests with handle detection:
  - npx jest --runInBand --detectOpenHandles --verbose

-------------------------------------------------------------------------------

8) Concurrency & Campaign Limits (approved defaults)

Approved production defaults:
- TELEPHONY_GLOBAL_MAX_CONCURRENCY=10000
- TELEPHONY_PER_CAMPAIGN_MAX_CONCURRENCY=100
- TELEPHONY_SEMAPHORE_TTL_SEC=600 (slot TTL to reclaim leaks safely)
- MAX_CONCURRENT_CALLS=200 (API-level outbound calls guard)

Where enforced:
- API outbound creation checks: [services.api.index()](../services/api/src/index.ts:238)
- Telephony (webhooks) should be wired to apply per-campaign/global limits at ingress decision; see Telephony service index:
  - [services.telephony.index()](../services/telephony/src/index.ts:1)

Operational guidance:
- See [docs.Concurrency-and-Limits.md](./Concurrency-and-Limits.md:1) for sample capacity math, validation runs, and tuning.

-------------------------------------------------------------------------------

9) End-to-end validation checklist (Go/No-Go)

- CI is green with OIDC role assumption and required checks (terraform plan uploaded, scanners pass).
- All tests pass locally and in CI:
  - npx jest --runInBand --detectOpenHandles --verbose (0 warnings)
- Public endpoints reachable:
  - https://api.invortoai.com/health returns 200
  - wss://api.invortoai.com/realtime/voice connects with subprotocol API key and returns {"t":"connected","callId":...}
- No dev URLs (localhost/http://localhost/ws:// except 127.0.0.1 in tests) in production code paths.
- README instructions sufficient for setup; Concurrency doc complete and cross-linked.
- CHANGELOG.md updated with shutdown lifecycle hooks, schema alignment, SDK URL documentation, CI OIDC and scanners, and URL guard.

-------------------------------------------------------------------------------

10) Troubleshooting

Common issues:
- OIDC role not assumed:
  - Check Actions logs for aws-actions/configure-aws-credentials
  - Verify AWS_OIDC_ROLE_ARN secret and IAM trust policy conditions
- ALB routing:
  - Ensure listener rules match paths, and target groups are healthy (/health endpoints)
- WS failing from browser due to CORS/Origin:
  - PUBLIC_BASE_URL must reflect your origin (same domain), and services enforce ACAO for deterministic origin in tests:
    - API/Webhooks ACAO: [services.api.index()](../services/api/src/index.ts:13), [services.webhooks.index()](../services/webhooks/src/index.ts:67)

-------------------------------------------------------------------------------

Appendix: Command quick reference

Local dev:
- npm ci
- docker compose up -d
- npm run dev -w services/api
- npm run dev -w services/realtime
- npm run dev -w services/webhooks

Tests:
- npx jest --runInBand --verbose
- npx jest --runInBand --detectOpenHandles --verbose

Terraform:
- cd infra/terraform
- terraform init -input=false
- terraform validate
- terraform plan -var="environment=prod" -no-color -out=tfplan
- terraform show -no-color tfplan > plan.txt
- terraform output -json > outputs.json

AWS ELB/Route53:
- aws elbv2 describe-load-balancers --region ap-south-1
- aws route53 list-resource-record-sets --hosted-zone-id <ZONE_ID>