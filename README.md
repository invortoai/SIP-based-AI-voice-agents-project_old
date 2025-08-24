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

```bash
# Run all tests
npm test

# Type checking
npm run typecheck

# Build all packages
npm run build
```

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

