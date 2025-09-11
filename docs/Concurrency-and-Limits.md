# Concurrency & Campaign Limits

This document explains how concurrency is controlled in the SIP-based AI voice agents platform, the environment variables and defaults, and how to validate and tune capacity safely.

## Concepts

- Global concurrency cap: Upper bound on the total number of active calls within the system for a tenant or environment.
- Per-campaign cap: Upper bound on the number of active calls for a given campaign or grouping key.
- TTL semantics: Concurrency slots are tracked with a time-to-live (TTL) so leaked slots are automatically reclaimed after a safety window.
- Backoff behavior: When limits are reached, APIs return 429 responses with structured error messages to allow callers to backoff and retry.
- Metrics and observability: Prometheus metrics expose counters and gauges to understand capacity usage and rejection rates.

## Configuration (Environment Variables)

The following environment variables control concurrency behavior (defaults shown in `.env.example`):

- TELEPHONY_GLOBAL_MAX_CONCURRENCY (default 100)
  - Global maximum allowed active calls at a time (all campaigns combined).
- TELEPHONY_PER_CAMPAIGN_MAX_CONCURRENCY (default 20)
  - Maximum allowed active calls per campaign (or grouping key).
- TELEPHONY_SEMAPHORE_TTL_SEC (default 3600)
  - TTL in seconds for concurrency slots to auto-expire if cleanup events are missed.
- MAX_CONCURRENT_CALLS (API service; default 10)
  - Additional application-level guard in API for outbound calls created via the REST API.

These values can be overridden per environment via ECS task definition environment variables or GitHub Actions deploy steps (see CI workflow). In production, ensure values reflect desired SLOs and upstream capacity (e.g., PSTN trunks, ASR/TTS quotas).

## Behavior

- When creating outbound calls (API: POST /v1/calls), the API validates the current counts vs caps and returns HTTP 429 with:
  - code: "rate_limit_exceeded" when the maximum concurrent calls is reached.
  - code: "usage_cap_exceeded" for daily usage cap example (if configured).

- For inbound calls via telephony webhooks, concurrency controls should be applied at decision points within the telephony service. If caps are exceeded, return a minimal instruction to gracefully reject or defer call handling.

- TTL behavior ensures that if a call is dropped without a proper teardown event, its slot will return to the pool after TELEPHONY_SEMAPHORE_TTL_SEC.

## Metrics and Health

- Prometheus metrics endpoints:
  - API: GET /metrics
  - Webhooks: GET /metrics and /metrics/summary
- Counters and gauges (examples):
  - http_requests_total{service,method,path,status}
  - webhooks_events_total{event}
  - Custom counters for rejections and queue depths (if applicable to telephony or webhook workers)

Dashboards should chart:
- 2xx/4xx/5xx rates by service and route
- Concurrency rejections (HTTP 429)
- Webhook queue size and DLQ size
- Realtime connected sockets (if exported via custom metrics)

## Validation & Tuning

1. Baseline
   - Set initial caps in `.env` or task definitions.
   - Deploy to staging and perform load tests (see tests/load/k6-load-test.js).
   - Observe error rate, p95/p99 latencies, and resource usage (CPU, memory, networking).

2. Incremental increases
   - Increase TELEPHONY_PER_CAMPAIGN_MAX_CONCURRENCY and TELEPHONY_GLOBAL_MAX_CONCURRENCY gradually.
   - Re-run scenario tests and confirm no 5xx error spikes or SLA regressions.

3. Operational alarms
   - Configure alert rules for:
     - Unhealthy target count > 0 on ALB target groups
     - 5xx spikes on API/Realtme/Webhooks
     - DLQ growth rate for webhooks
     - Sustained 429 rate exceeding a threshold (indicating throttling or saturation)

4. Incident checklist
   - Check /health and /metrics on affected services.
   - Validate Redis connectivity.
   - Review recent deploys and configuration changes for env var drift.
   - If urgent, temporarily reduce concurrency or route a smaller subset of traffic while investigating.

## Example: Staging Defaults

- TELEPHONY_GLOBAL_MAX_CONCURRENCY=50
- TELEPHONY_PER_CAMPAIGN_MAX_CONCURRENCY=10
- TELEPHONY_SEMAPHORE_TTL_SEC=600

Adjust based on staging cluster capacity and planned test load. For production, sizing depends on trunk capacity, ASR/TTS quotas, and acceptable headroom.

## Notes

- The API currently enforces an additional MAX_CONCURRENT_CALLS safety check for simple outbound dialing examples. Ensure this does not conflict with your telephony caps.
- All concurrency changes should be accompanied by load/perf tests and metrics review to avoid inadvertent overload or cost spikes.