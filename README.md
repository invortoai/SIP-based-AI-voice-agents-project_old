## Invorto Voice AI Agent Platform (Monorepo)

This repository contains the one-phase GA implementation scaffold for the Invorto Voice AI Agent Platform as per the SRS.

### 🏗️ Workspaces

#### Core Services
- `packages/shared`: Shared types, message schemas, utilities
- `services/realtime`: WebSocket gateway for realtime audio and events
- `services/api`: REST API for agents, calls, metrics
- `services/webhooks`: Webhooks dispatcher service with HMAC utilities
- `services/workers`: Background workers for Redis Streams and S3 artifacts

#### SDKs
- `sdk/node`: Node.js/TypeScript server SDK
- `sdk/python`: Python SDK with Pydantic models
- `sdk/browser-realtime`: Browser WebSocket realtime client

#### Infrastructure
- `infra/terraform`: Terraform IaC for AWS deployment

### 🚀 Quick Start

1. **Prerequisites**
   - Node.js 20+
   - Docker & Docker Compose
   - Python 3.9+ (for Python SDK)

2. **Setup**
   ```bash
   # Clone and install
   git clone <repository>
   cd invorto-voice-ai-platform
   npm install
   
   # Start local development environment
   ./scripts/dev.sh
   ```

3. **Local Development**
   - Copy `.env.example` to `.env` and adjust values
   - Start infra: `docker compose up -d`
   - Run services:
     - Realtime: `npm run dev -w services/realtime`
     - API: `npm run dev -w services/api`
     - Webhooks: `npm run dev -w services/webhooks`
     - Workers: `npm run dev -w services/workers`

### 📚 SDK Usage

#### Node.js
```typescript
import { InvortoClient } from '@invorto/server';

const client = new InvortoClient('your-api-key');
const agent = await client.createAgent({
  name: 'Support Agent',
  prompt: 'You are a helpful customer support agent.'
});
```

#### Python
```python
from invorto import InvortoClient, AgentConfig

client = InvortoClient('your-api-key')
agent = client.create_agent(AgentConfig(
    name='Support Agent',
    prompt='You are a helpful customer support agent.'
))
```

#### Browser
```typescript
import { RealtimeClient } from '@invorto/browser-realtime';

const client = new RealtimeClient();
client.connect('call-123', 'agent-456', 'your-api-key');
client.on('message', (msg) => console.log('Received:', msg));
```

### 🏗️ Infrastructure

The project includes Terraform IaC for AWS deployment:

```bash
cd infra/terraform
terraform init
terraform plan -var="environment=dev"
terraform apply -var="environment=dev"
```

**Components:**
- VPC with 3 AZs private, 2 AZs public
- ECS Fargate cluster for services
- ALB with WebSocket support and WAF
- ElastiCache Redis
- S3 buckets for recordings/transcripts
- Secrets Manager for credentials

### 🔄 CI/CD

GitHub Actions workflows for:
- Build & test on PRs
- Security scanning with Trivy
- Staging deployment on `develop` branch
- Production deployment with canary on `main` branch

### 📖 Documentation

See `one_phase_ga_srs_invorto_voice_ai_voice_agent_platform.md` for complete specifications.

### 🧪 Testing

Prerequisites:
- Node.js 20+
- npm
- No external services are required for unit/integration tests; Redis is mocked via ioredis-mock in tests.

Environment setup:
- Copy `.env.example` to `.env` as needed.
- For Jest runs, tests load `tests/.env.test` automatically (created in CI) and fall back to safe defaults in [tests/setup.ts](tests/setup.ts:1).
- Telephony concurrency envs are enforced in code:
  - TELEPHONY_GLOBAL_MAX_CONCURRENCY (global cap)
  - TELEPHONY_PER_CAMPAIGN_MAX_CONCURRENCY (per-campaign cap)
  - For local tests these default to small values; override in `tests/.env.test` if required.

Common commands:
```bash
# Install dependencies
npm install

# Run all tests (uses local jest binary)
npm test

# Run tests in-band (Windows-friendly and CI-safe)
npm run test:ci

# Run only unit tests
npm run test:unit

# Run only integration tests
npm run test:integration

# If you see "jest is not recognized", use npx to resolve local binary:
npx jest --runInBand
```

Notes:
- If you encounter type errors about Jest matchers in the editor, a fallback is provided at [tests/jest-globals.d.ts](tests/jest-globals.d.ts:1), while CI uses @types/jest through ts-jest.
- Integration tests spin up Fastify apps in-memory and mock external systems; services skip binding to network ports during tests via the JEST_WORKER_ID/NODE_ENV guards.
- For environment overrides specific to tests, place them in `tests/.env.test` (e.g., TELEPHONY_GLOBAL_MAX_CONCURRENCY, TELEPHONY_PER_CAMPAIGN_MAX_CONCURRENCY).

### 📦 Development Scripts

- `./scripts/dev.sh` - Start full development environment
- `./scripts/stop-dev.sh` - Stop development environment
- `npm run dev -w <workspace>` - Start specific service
- `npm run build` - Build all workspaces

### 🔧 Architecture

```
PSTN/SIP ↔ Jambonz ↔ Realtime WS Gateway ↔ ASR ↔ Agent Runtime ↔ TTS
                ↓                              ↓         ↓
            Webhooks ← Event Bus (Redis) ← Postgres ← S3 Storage
```

### 📄 License

Apache 2.0



### ☎️ Jambonz SIP Edge Integration

- SIP ingress/egress is handled by Jambonz. Calls are bridged to our realtime WS gateway.
- Control flow:
  - Inbound: Jambonz invokes our HTTPS hooks → we respond with a connect/stream verb pointing at our WS.
  - Outbound: API can originate via Jambonz (optional) using call_hook and call_status_hook pointing back to us.

Endpoints (single-domain)
- REST (API): https://api.invortoai.com
- Webhooks: https://api.invortoai.com/webhooks
- Telephony hooks: https://api.invortoai.com/telephony/*
- Realtime WS: wss://api.invortoai.com/realtime/voice

Example Jambonz call control (connect/stream)
{
  "application_sid": "your-app-sid",
  "call_hook": [
    { "verb": "stream", "url": "wss://api.invortoai.com/realtime/voice?callId=${CALL_SID}", "metadata": { "source": "pstn", "provider": "jambonz" } }
  ]
}

### 🔗 Call Hooks

- call_hook (initial): POST https://api.invortoai.com/telephony/jambonz/call
- call_status_hook (updates): POST https://api.invortoai.com/telephony/jambonz/status

Recommended:
- HMAC header (x-jambonz-signature) with shared secret (JAMBONZ_WEBHOOK_SECRET)
- Retry: exponential backoff with jitter; idempotency keys by call_sid.

Sample call_hook payload (Jambonz)
{
  "call_sid": "C123",
  "direction": "inbound",
  "from": "+1xxx",
  "to": "+1yyy",
  "call_status": "ringing"
}

### 🧵 Realtime WS Protocol

- Endpoint: wss://api.invortoai.com/realtime/voice?callId=:id[&agentId=:agent]
- Auth:
  - Preferred: API key via Sec-WebSocket-Protocol subprotocol header.
  - Also supported: Bearer token, optional HMAC via sig/ts query.
- Messages (selected):
  - Client→Server:
    - {"t":"start","callId":"...","agentId":"..."}
    - {"t":"dtmf.send","digits":"123","method":"rfc2833"}
    - Binary audio frames: raw PCM16 LE, 16kHz, mono, 20–40 ms frames
  - Server→Client:
    - {"t":"connected","callId":"...","timestamp":...}
    - {"t":"stt.partial","text":"..."} | {"t":"stt.final","text":"..."}
    - {"t":"tts.chunk","seq":n,"pcm16":<Uint8Array or base64>}
    - {"t":"emotion.window","energy_db":-45.0,"speaking":true}
- Heartbeats: client may send {"t":"ping"}; server replies {"t":"pong","timestamp":...}
- Reconnects: SDKs support auto-retry with backoff.

### 🔐 Auth Modes

- API key (preferred): WS subprotocol header; also accepted via query api_key or Authorization: Bearer.
- Optional HMAC guard: sig and ts query parameters, verified as HMAC-SHA256(callId:ts).

### ⚙️ Environment Variables (key)

- PUBLIC_BASE_URL=https://api.invortoai.com
- API_BASE_URL=https://api.invortoai.com/v1
- REALTIME_WS_URL=wss://api.invortoai.com/realtime/voice
- WEBHOOK_BASE_URL=https://api.invortoai.com/webhooks
- TELEPHONY_WEBHOOK_BASE_URL=https://api.invortoai.com/telephony
- REALTIME_API_KEY=...
- REALTIME_WS_SECRET=... (for HMAC)
- JAMBONZ_WEBHOOK_SECRET=...
- TELEPHONY_GLOBAL_MAX_CONCURRENCY, TELEPHONY_PER_CAMPAIGN_MAX_CONCURRENCY, TELEPHONY_SEMAPHORE_TTL_SEC

### 🧭 Runbooks (high-level)

- Realtime incidents:
  - Verify ALB target health; check service logs for unauthorized/forbidden_origin codes.
  - Validate WS auth header and Origin; confirm REALTIME_WS_URL and PUBLIC_BASE_URL alignment.
- Telephony congestion:
  - Inspect /telephony/limits for global/campaign counts; adjust caps via env; ensure Redis reachable.
- Webhook spikes:
  - Monitor queue length; scale webhooks service; ensure HMAC verifies (shared secret set).

### 🧪 SDK usage quickstart (defaults)

Node
import { InvortoClient } from "./sdk/node/src/client";
const client = new InvortoClient(process.env.API_KEY || "");
const rt = await client.connectToCall("call-123", { agentId: "agent-abc" });
// send PCM16 Buffer frames via rt.sendAudio()

Browser
import { RealtimeClient } from "./sdk/browser/src/realtime-client";
const rt = new RealtimeClient(); // wss://api.invortoai.com/realtime/voice
await rt.connect("call-123","agent-abc","YOUR_API_KEY");


### SDK URL overrides

- Node SDK defaults:
  - Base HTTP API: https://api.invortoai.com
  - Realtime WS URL resolution:
    - If REALTIME_WS_URL is set, it takes precedence and is used directly.
    - Otherwise, the HTTP base is converted to ws(s) and suffixed with /realtime/voice.
  - Implementation references:
    - [sdk.node.client()](sdk/node/src/client.ts:30)
    - [sdk.node.realtime-client()](sdk/node/src/realtime-client.ts:89)
    - [sdk.node.realtime-client.connect()](sdk/node/src/realtime-client.ts:108)

- Browser SDK defaults:
  - Default WebSocket base: wss://api.invortoai.com/realtime/voice
  - To override (e.g., local dev), pass a custom base to the constructor:
    - const rt = new RealtimeClient("ws://127.0.0.1:8081");
    - It will append /realtime/voice if missing and add query parameters.
  - Implementation references:
    - [sdk.browser.realtime-client()](sdk/browser/src/realtime-client.ts:155)

- Tests covering URL selection:
  - [tests.unit.sdk-url-defaults()](tests/unit/sdk-url-defaults.test.ts:1)
  - [tests.integration.node-sdk-realtime()](tests/integration/node-sdk-realtime.test.ts:1)
  - [tests.integration.browser-sdk-realtime()](tests/integration/browser-sdk-realtime.test.ts:1)

### Concurrency & Campaign Limits

- Full guide with defaults, metrics, and tuning recommendations:
  - [docs.Concurrency-and-Limits.md](docs/Concurrency-and-Limits.md:1)
- Key environment variables and defaults:
  - TELEPHONY_GLOBAL_MAX_CONCURRENCY (global cap)
  - TELEPHONY_PER_CAMPAIGN_MAX_CONCURRENCY (per-campaign cap)
  - TELEPHONY_SEMAPHORE_TTL_SEC (slot TTL)
  - MAX_CONCURRENT_CALLS (API-level outbound call guard)
- Related code paths:
  - API concurrency checks in [services.api.index()](services/api/src/index.ts:238)
  - Telephony webhooks and queues in [services.telephony.index()](services/telephony/src/index.ts:1)
