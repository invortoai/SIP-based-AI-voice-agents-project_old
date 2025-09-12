# Concurrency & Campaign Limits (Operator Guide)

This guide defines how concurrency is controlled end-to-end, which environment variables configure limits, how to validate and tune safely, and where limits are enforced in code. Defaults reflect the approved production settings.

Cross-references:

- API limit checks: [services.api.index()](../services/api/src/index.ts:215)
- Realtime/Webhooks (Redis-backed features): [services.realtime.index()](../services/realtime/src/index.ts:1), [services.webhooks.index()](../services/webhooks/src/index.ts:1)
- Telephony service ingress (campaign/global enforcement site): [services.telephony.index()](../services/telephony/src/index.ts:1)

-------------------------------------------------------------------------------

1) Concepts

- Global concurrency cap: Upper bound on concurrently active calls across all campaigns/tenants.
- Per-campaign cap: Upper bound on concurrently active calls within a specific campaign (or grouping key).
- TTL-based slot reclamation: Concurrency slots are tracked via Redis with a TTL so abandoned/leaked slots are automatically reclaimed after a safety window.
- API-level guard: Additional “circuit breaker” at API outbound endpoints to prevent over-origination even if Redis is slow/unavailable.
- Observability: Prometheus metrics and logs expose request volumes, rejections (429), and health.

-------------------------------------------------------------------------------

2) Environment variables (production defaults)

Approved defaults for production:

- TELEPHONY_GLOBAL_MAX_CONCURRENCY=10000
  - Maximum allowed concurrent calls overall.
- TELEPHONY_PER_CAMPAIGN_MAX_CONCURRENCY=100
  - Maximum allowed concurrent calls for a single campaign/group.
- TELEPHONY_SEMAPHORE_TTL_SEC=600
  - TTL (seconds) on concurrency slots to reclaim leaked entries if a call ends abnormally and cleanup events are missed.
  - Rationale: 10 minutes balances safety (avoiding double-use of a slot for long-abandoned calls) and recovery speed.
- MAX_CONCURRENT_CALLS=200
  - API-level guard on outbound create calls. This is additive protection; set high enough not to throttle valid traffic if Redis enforcement is healthy.

Where to set:

- ECS Task Definitions via Terraform/CI (preferred)
- Local: .env (see [.env.example](../.env.example:1))

-------------------------------------------------------------------------------

3) Enforcement points in the code

- API rate/usage checks (outbound call creation):
  - [services.api.index()](../services/api/src/index.ts:215)
  - Checks “concurrent calls” and “daily usage” (if enabled) to decide on 429 “rate_limit_exceeded” or “usage_cap_exceeded”.
  - This is not Redis-backed concurrency; it’s an API-level safety net.
- Telephony service ingress (campaign/global):
  - [services.telephony.index()](../services/telephony/src/index.ts:1)
  - Intended site for Redis-backed semaphores:
    - Key design: a global key for overall concurrency, and campaign keys per-campaign.
    - On receiving an inbound webhook, attempt to acquire slots (SET/INCR with expiry).
    - On call termination webhook or internal completion event, release/decrement slots.
- TTL behavior (slot reclamation):
  - Use Redis TTL when incrementing/setting semaphore keys so slots expire automatically (TELEPHONY_SEMAPHORE_TTL_SEC).
  - If a call ends cleanly, explicitly release the slot early (do not wait for TTL).

-------------------------------------------------------------------------------

4) Sample capacity planning

Given:

- TELEPHONY_GLOBAL_MAX_CONCURRENCY=10000
- TELEPHONY_PER_CAMPAIGN_MAX_CONCURRENCY=100
- Average call duration (ACD): 3 minutes
- Target utilization: 70–80%

Simple calculations:

- Maximum sustainable starts per minute per campaign:
  - = PER_CAMPAIGN_MAX / ACD_minutes
  - = 100 / 3 ≈ 33 starts/minute/campaign (at full utilization)
- Global theoretical ceiling for starts/min (all campaigns):
  - = GLOBAL_MAX / ACD_minutes
  - = 10000 / 3 ≈ 3333 starts/min (upper bound; real-world bottlenecks like trunks/ASR/TTS apply)
- Start with lower caps in production and scale up gradually, observing error rates and latencies.

-------------------------------------------------------------------------------

5) Validation and tuning procedure

Baseline (staging or low-traffic prod):

1. Set TELEPHONY_PER_CAMPAIGN_MAX_CONCURRENCY=20, TELEPHONY_GLOBAL_MAX_CONCURRENCY=500 (for initial bake-in if desired).
2. Drive traffic (or run synthetic load) to approach limits:
   - Validate that calls beyond the caps receive deterministic rejections (HTTP 429 or equivalent), not 5xx.
3. Review metrics and logs:
   - API: HTTP codes, p95/p99 latency
   - Realtime/Webhooks: request rate, error rate
   - Redis health (latency, timeouts)
4. Increase caps incrementally and repeat.

Safety/rollback:

- Reduce caps if error rate increases or upstream capacity (PSTN/ASR/TTS) saturates.
- Verify TTL behavior: forcibly kill test calls to ensure slots auto-reclaim after TELEPHONY_SEMAPHORE_TTL_SEC.

-------------------------------------------------------------------------------

6) Operational metrics and alerts

Endpoints:

- API: /metrics ([services.api.index()](../services/api/src/index.ts:190))
- Webhooks: /metrics and /metrics/summary ([services.webhooks.index()](../services/webhooks/src/index.ts:287), [services.webhooks.index()](../services/webhooks/src/index.ts:658))
- Realtime: /metrics ([services.realtime.index()](../services/realtime/src/index.ts:67))

Dashboards:

- Requests/second, error rates (4xx/5xx), response time heatmaps
- Concurrency rejections (429) over time
- Redis ops (latency/timeouts)
- Webhook queue depth and DLQ size

Alerts:

- 5xx rate sustained above threshold (e.g., >1% for >5 minutes)
- Redis connection issues
- Unhealthy target count on ALB target groups
- Webhook DLQ growth rate

-------------------------------------------------------------------------------

7) Implementation blueprint for Redis-backed semaphores (telephony)

Recommended key scheme:

- Global key: sem:global:concurrency
- Campaign key: sem:campaign:{campaignId}:concurrency

Acquire (pseudocode):

- INCR key
- If value > limit → DECR and reject; else EXPIRE key TELEPHONY_SEMAPHORE_TTL_SEC

Release (on end):

- DECR key (don’t go below zero)
- For defensive cleanup, consider periodic reconciliation to correct drift.

Notes:

- If worker restarts are frequent, use EXPIRE on every increment to refresh TTL.
- For multi-node correctness, consider Lua scripts for atomic check-increment-expire if needed.

-------------------------------------------------------------------------------

8) API-level guard (MAX_CONCURRENT_CALLS)

Location:

- [services.api.index()](../services/api/src/index.ts:215)

Purpose:

- Quick safety net to avoid DB/Redis issues cascading into excessive outbound origination.
- Set high enough not to throttle valid traffic when Redis-backed limits work (e.g., MAX_CONCURRENT_CALLS=200).

-------------------------------------------------------------------------------

9) Configuration matrix (Dev/Stage/Prod)

Dev:

- TELEPHONY_GLOBAL_MAX_CONCURRENCY: 50–200
- TELEPHONY_PER_CAMPAIGN_MAX_CONCURRENCY: 10–20
- TELEPHONY_SEMAPHORE_TTL_SEC: 300–600
- MAX_CONCURRENT_CALLS: 50–100

Stage:

- Start lower than prod; tune with expected load

Prod (approved defaults):

- TELEPHONY_GLOBAL_MAX_CONCURRENCY=10000
- TELEPHONY_PER_CAMPAIGN_MAX_CONCURRENCY=100
- TELEPHONY_SEMAPHORE_TTL_SEC=600
- MAX_CONCURRENT_CALLS=200

-------------------------------------------------------------------------------

10) Change management and audits

- Document changes to caps in CHANGELOG and/or operational runbooks.
- Include capacity changes in release notes and communicate to stakeholders.
- If caps are enforced via Terraform variables, gate changes through PR reviews in CI.

-------------------------------------------------------------------------------

11) Quick checklist

- [ ] Confirm .env (or ECS env) includes approved defaults
- [ ] Confirm Redis enforcement in Telephony ingress (global and campaign) with TTL
- [ ] Validate with synthetic load at target utilization
- [ ] Check rejection mode (429) and confirm zero 5xx during throttling
- [ ] Monitor metrics and logs for errors, latencies, webhook queues
- [ ] Document final caps and rationale
