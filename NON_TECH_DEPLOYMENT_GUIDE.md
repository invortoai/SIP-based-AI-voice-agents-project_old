# Invorto Voice AI Platform

Non‑technical Setup, Testing, Deployment and Monitoring Guide
> Deprecation notice
> This file is retained for non‑technical orientation. For authoritative, up‑to‑date deployment procedures, URLs, CI behavior, and environment specifics, see:
>
> - [docs.DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md)
> - [docs.PRODUCTION-DEPLOYMENT.md](docs/PRODUCTION-DEPLOYMENT.md)
> Canonical domains and endpoints:
> - Production: <https://api.invortoai.com>
> - Staging: <https://staging.invortoai.com>
> - Public smoke: GET <https://api.invortoai.com/v1/health>
> - Realtime WebSocket: wss://api.invortoai.com/realtime/voice

This guide lets a non‑developer run the platform locally, validate functionality, deploy to AWS, test after deployment, and monitor/handle incidents.

--------------------------------------------------------------------------------

1) What the system does

- Handles phone/WebSocket audio: user speech → ASR (Deepgram) → LLM (OpenAI) → TTS (Deepgram) → back to caller.
- Core services:
  - API (REST) – agents, calls, artifacts, costing
  - Realtime (WebSocket) – low‑latency audio loop, agent runtime
  - Telephony – webhooks for Jambonz SIP/media
  - Webhooks – queue + retries + DLQ
  - Workers – background processing (analytics, costs, webhooks)
- Infrastructure:
  - Terraform deploys AWS (VPC, ECS, ALB, Redis, S3, RDS or Supabase, Secrets)
  - CI/CD with GitHub Actions

--------------------------------------------------------------------------------

2) Prerequisites

Local machine

- Node.js 20+
- Docker Desktop (or Docker Engine) and docker compose
- Git
- A code editor (VS Code recommended)

Cloud (for deployment)

- AWS account with programmatic access
- Terraform CLI 1.0+
- (Recommended) GitHub repository access for CI/CD runners
- Domain name with DNS control (for HTTPS)

Vendors (API keys)

- OpenAI API key (LLM)
- Deepgram API key (ASR + TTS)
- (Optional) Supabase project if using managed Postgres

--------------------------------------------------------------------------------

3) Environment variables (what you need to set)

Create a .env file at the repository root. To start, copy from [".env.example"](./.env.example) and edit values. Common variables are explained below.

Core provider keys

- OPENAI_API_KEY – Your OpenAI key for GPT‑4o‑mini
- DEEPGRAM_API_KEY – Your Deepgram key for Nova (ASR) and Aura‑2 (TTS)

Service endpoints

- DB_URL – Postgres connection (local: postgresql://invorto:invorto@localhost:5432/invorto)
- REDIS_URL – Redis connection (local: redis://localhost:6379)
- TENANT_WEBHOOK_URL – If you want platform events to be posted to your server
- WEBHOOK_SECRET – HMAC secret used by webhooks service
- JWT_SECRET – Secret key for JWT auth (local dev can be any long random string)

S3/Storage (local dev can be placeholder when not using AWS)

- S3_BUCKET_RECORDINGS – Bucket for audio recordings
- S3_BUCKET_TRANSCRIPTS – Bucket for transcripts
- S3_BUCKET_METRICS – Bucket for metrics and artifacts

Realtime + Telephony

- REALTIME_WS_URL – URL of Realtime WS (local: ws://localhost:8081/realtime/voice)
- PUBLIC_BASE_URL – Public URL to reach Telephony service webhooks (local: <http://localhost:8085>)
- ALLOWED_JAMBONZ_IPS – optional allowlist for telephony webhooks
- TELEPHONY_SHARED_SECRET – optional shared header check for telephony webhooks
- JAMBONZ_OUTCALL_URL – Jambonz API endpoint to originate outbound calls (optional)
- JAMBONZ_TOKEN – Token for Jambonz API
- JAMBONZ_APP_SID – Application SID used by Jambonz
- TELEPHONY_CALL_HOOK – Telephony webhook endpoint (local: <http://telephony:8085/call>)

Ports (defaults used by services)

- API: 8080
- Realtime: 8081
- Webhooks: 8082
- Telephony: 8085
- Redis: 6379
- Postgres: 5432

AWS/Terraform (for deployment)

- AWS_ACCESS_KEY_ID
- AWS_SECRET_ACCESS_KEY
- AWS_REGION (e.g., ap-south-1)
- Terraform variables are set in terraform.tfvars (see below)

Optional Observability (if used)

- LANGFUSE_ENABLED, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_BASE_URL

Tip: For local testing, set providers and core endpoints only. For AWS deployment, fill all relevant infra settings.

--------------------------------------------------------------------------------

4) Run locally (all steps)

A. Clone and install

- git clone <your-repo-url>
- cd invorto-voice-ai-platform
- cp .env.example .env
- Edit .env and fill at least:
  - OPENAI_API_KEY
  - DEEPGRAM_API_KEY
  - DB_URL (local Postgres)
  - REDIS_URL (local Redis)

- npm install

B. Start local dependencies (Postgres + Redis)

- docker compose up -d

C. Start services (dev mode, in separate terminals or using script)
Option 1 – All via helper script

- ./scripts/dev.sh
It will:
- install deps, bring up Postgres/Redis, build, and run API, Realtime, Webhooks, Workers
Option 2 – Manual start by workspace
- npm run dev -w services/api
- npm run dev -w services/realtime
- npm run dev -w services/webhooks
- npm run dev -w services/workers
- (Optional) npm run dev -w services/telephony

D. Health checks (browser or curl)

- API: <http://localhost:8080/health>
- Realtime: <http://localhost:8081/health>
- Webhooks: <http://localhost:8082/health>
- Telephony: <http://localhost:8085/health>

E. Basic smoke tests

- Create an agent via API (use Postman or curl)
  POST <http://localhost:8080/v1/agents>
  Body: { "name": "Support Agent", "config": { "prompt": "You are a helpful agent." } }
- Try Realtime WS with the smoke script
  node [tests/realtime/smoke-client.js](tests/realtime/smoke-client.js)
  It should connect, send/receive events, and you’ll see logs.

F. Metrics endpoints (optional)

- API Prometheus: <http://localhost:8080/metrics>
- Realtime Prometheus: <http://localhost:8081/metrics>
- Webhooks Prometheus: <http://localhost:8082/metrics>

--------------------------------------------------------------------------------

5) Common local troubleshooting

Ports already in use

- Another app using 8080/8081/8082/8085? Stop that app or change port in .env.

Auth errors with providers

- Verify OPENAI_API_KEY and DEEPGRAM_API_KEY are correct and not rate‑limited.

Realtime WS won’t connect

- Check <http://localhost:8081/health>
- Make sure your browser or script is using the correct ws:// URL

No audio or broken audio

- Confirm the smoke client is sending PCM16 frames
- Check console logs for “stt.partial” or “stt.final” messages
- Ensure Deepgram keys are valid

--------------------------------------------------------------------------------

6) Prepare for AWS deployment (Terraform)

A. Set up Terraform variables file

- cd infra/terraform
- Create a file named terraform.tfvars with your values, based on the guide in [docs.DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md). Example:

environment = "prod"
aws_region  = "ap-south-1"
dr_region   = "us-east-1"

github_connection_arn = "arn:aws:codestar-connections:REGION:ACCOUNT:connection/xxx"
github_repository     = "your-org/voice-ai-platform"
github_branch         = "main"

monthly_budget          = 2000
daily_cost_limit        = 100
budget_notification_emails = ["ops@yourco.com"]

enable_email_alerts = true
alert_email         = "<alerts@yourco.com>"

enable_cost_email_alerts  = true
cost_alert_email          = "<cost-alerts@yourco.com>"

B. Initialize and plan

- terraform init
- terraform plan -var-file="terraform.tfvars"

C. Apply

- terraform apply -var-file="terraform.tfvars"
This provisions VPC, ECS, ALB, Redis, S3, Secrets, monitoring, etc.

D. Push Docker images

- CI/CD workflow [.github/workflows/ci.yml](.github/workflows/ci.yml) builds and pushes images on pushes to main/develop.
- Ensure GitHub secrets are set:
  - AWS_OIDC_ROLE_ARN (required for OIDC role assumption; no static AWS keys)
  - SLACK_WEBHOOK (optional)
  - K6_CLOUD_TOKEN (optional for load tests)

E. Configure DNS (production)

- Point your domain to the ALB address
- ACM certificate created via Terraform; validate DNS CNAMEs for issuance

--------------------------------------------------------------------------------

7) Post-deployment validation (staging/production)

A. Health checks (replace domain as appropriate)

- curl -f <https://api.invortoai.com/v1/health>
- curl -f <https://api.invortoai.com/metrics>
- curl -f <https://api.invortoai.com/v1/realtime/connections> (basic status)

B. Try basic API flows

- Create an agent
  POST <https://api.invortoai.com/v1/agents>
- Create a call
  POST <https://api.invortoai.com/v1/calls>
- Check timeline
  GET  <https://api.invortoai.com/v1/calls/{id}/timeline>
- Get artifacts (signed URLs)
  GET  <https://api.invortoai.com/v1/calls/{id}/artifacts>

C. Realtime smoke

- Point smoke client to WSS endpoint
  wss://api.invortoai.com/realtime/voice?callId={callId}
- Verify events: connected → stt.partial/final → llm.delta → tts.chunk

D. Telephony (if Jambonz wired)

- Inbound call webhook to /call should redirect media to Realtime WS
- Call status webhooks should hit /status/{id}
- Validate DTMF pass‑through:
  POST /dtmf/{id} with { "digits": "123" }

--------------------------------------------------------------------------------

8) Operations: Monitoring & incidents

Dashboards

- CloudWatch service dashboards and logs (ECS task logs under /ecs/invorto-*)
- Prometheus metrics (per-service /metrics endpoints)

Alarms and alerts

- CloudWatch alarms on service health, error rates
- Budget and cost anomaly alerts (daily budget, monthly budgets)
- Slack/email notifications (configured via Terraform)

Log access

- AWS Console → CloudWatch → Log groups:
  - /ecs/invorto-api
  - /ecs/invorto-realtime
  - /ecs/invorto-webhooks
  - /ecs/invorto-workers
  - /ecs/invorto-telephony

Runbooks (typical issues)

- Realtime degraded:
  - Check /health and /metrics
  - Review ECS service events
  - Restart task or scale desired count
- Provider outage (OpenAI/Deepgram):
  - Error spikes in logs
  - Consider temporarily reducing traffic or switching model if enabled
- Webhook backlog:
  - Check Redis list sizes: webhooks:queue, webhooks:retry, webhooks:dlq
  - Increase workers or investigate failing downstream endpoint
- Telephony issues:
  - Validate /call and /status webhooks receiving
  - Check Jambonz instance logs and security groups

Rollbacks

- ECS blue/green upgrade is handled by CI/CD
- To rollback:
  - Revert commit or deploy previous image tag
  - Force new deployment via ECS:
    aws ecs update-service --cluster invorto-production --service invorto-api --force-new-deployment

Capacity/scaling

- Auto scaling policies applied; can adjust min/max desired counts in Terraform
- Realtime service scales by connection count and CPU

Backups & DR

- Verify S3 versioning and backup plans weekly
- Test restore of critical artifacts monthly

--------------------------------------------------------------------------------

9) Local/Cloud testing checklist

Local

- All services healthy (HTTP 200 on /health)
- Realtime smoke script connects and receives stt/llm/tts events
- A test agent can be created and a test call record created

Staging

- Health checks and metrics good for 24 hours
- Synthetic test (hourly) passes (WS connect, small utterance response)
- No critical errors in CloudWatch logs

Production

- Canary at low traffic slice (10%) shows p95 latency within SLO (user->bot ≤ 1.5s)
- Error rate < 1%
- Cost budgets configured; alerts working
- On‑call rotation and alert channels verified

--------------------------------------------------------------------------------

10) Quick reference (commands)

Local dev

- docker compose up -d
- npm run dev -w services/realtime
- npm run dev -w services/api
- npm run dev -w services/webhooks
- npm run dev -w services/workers

Type checking and tests

- npm run typecheck
- npm test

Terraform

- cd infra/terraform
- terraform init
- terraform plan -var-file="terraform.tfvars"
- terraform apply -var-file="terraform.tfvars"

ECS force redeploy (example)

- aws ecs update-service --cluster invorto-production --service invorto-api --force-new-deployment --region ap-south-1

--------------------------------------------------------------------------------

11) Contacts & escalation

- Engineering on-call: <your-team@yourco.com>
- Cloud operations: <cloud-ops@yourco.com>
- Vendor status pages:
  - OpenAI: <https://status.openai.com>
  - Deepgram: <https://status.deepgram.com>
  - AWS Health: <https://phd.aws.amazon.com/>

--------------------------------------------------------------------------------

Appendix: File map (for reference)

- Realtime service entrypoint: [services/realtime/src/index.ts](services/realtime/src/index.ts:1)
- Agent runtime: [services/realtime/src/runtime/agent.ts](services/realtime/src/runtime/agent.ts:1)
- ASR adapter (Deepgram WS): [services/realtime/src/adapters/asr/deepgram_ws.ts](services/realtime/src/adapters/asr/deepgram_ws.ts:1)
- LLM adapter (OpenAI): [services/realtime/src/adapters/llm/openai.ts](services/realtime/src/adapters/llm/openai.ts:1)
- TTS adapter (Deepgram): [services/realtime/src/adapters/tts/deepgram.ts](services/realtime/src/adapters/tts/deepgram.ts:1)
- Telephony service: [services/telephony/src/index.ts](services/telephony/src/index.ts:1)
- API service: [services/api/src/index.ts](services/api/src/index.ts:1)
- Webhooks service: [services/webhooks/src/index.ts](services/webhooks/src/index.ts:1)
- Workers service: [services/workers/src/index.ts](services/workers/src/index.ts:1)
- Terraform root: [infra/terraform/main.tf](infra/terraform/main.tf:1)
- CI/CD: [.github/workflows/ci.yml](.github/workflows/ci.yml:1)

This guide is intentionally practical and copy‑paste‑ready to help non‑technical operators get from zero to working system, then deploy and monitor it safely.
