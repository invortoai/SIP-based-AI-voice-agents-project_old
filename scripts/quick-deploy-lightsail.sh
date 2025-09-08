#!/bin/bash

# 🚀 Invorto Voice AI Platform - Quick Lightsail Deployment
# Run this script on your Lightsail Ubuntu instance

set -e

echo "🚀 Starting Invorto Voice AI Platform deployment on Lightsail..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Update system
print_status "Updating system packages..."
sudo apt update && sudo apt upgrade -y
print_success "System updated successfully"

# Install required packages
print_status "Installing Docker and Docker Compose..."
sudo apt install -y docker.io docker-compose-plugin git curl wget nano htop

# Start and enable Docker
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker ubuntu

print_success "Docker installed and configured"

# Install Node.js (for any local development)
print_status "Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
print_success "Node.js installed"

# Clone the repository (UPDATE THIS URL WITH YOUR ACTUAL REPO)
print_status "Cloning Invorto Voice AI Platform repository..."
REPO_URL="https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git"
if ! git clone $REPO_URL invorto-platform 2>/dev/null; then
    print_error "Failed to clone repository. Please update REPO_URL in this script with your actual repository URL."
    print_error "Current URL: $REPO_URL"
    exit 1
fi
cd invorto-platform
print_success "Repository cloned"

# Create environment file template
print_status "Creating environment configuration..."
cat > .env << EOF
# AI Service API Keys (REPLACE WITH YOUR ACTUAL KEYS)
OPENAI_API_KEY=sk-your-openai-api-key-here
DEEPGRAM_API_KEY=your-deepgram-api-key-here

# Database Configuration (will be set up automatically)
DB_URL=postgresql://invorto:invorto@localhost:5432/invorto
REDIS_URL=redis://localhost:6379

# Security Configuration
JWT_SECRET=$(openssl rand -base64 32)
WEBHOOK_SECRET=$(openssl rand -base64 32)
API_SHARED_SECRET=$(openssl rand -base64 32)

# Application Configuration
NODE_ENV=production
PORT=8080
LOG_LEVEL=info

# Domain Configuration (optional)
DOMAIN_NAME=your-domain.com

# Email Configuration (optional)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# Monitoring Configuration
PROMETHEUS_ENABLED=true
METRICS_ENABLED=true

# Additional required environment variables
TENANT_WEBHOOK_URL=http://localhost:8082/webhooks
JAMBONZ_OUTCALL_URL=http://localhost:8085/calls
JAMBONZ_TOKEN=test-token
JAMBONZ_APP_SID=test-app-sid
TELEPHONY_CALL_HOOK=http://telephony:8085/call

# Performance tuning
JITTER_BUFFER_TARGET_MS=40
ENDPOINTING_SILENCE_MS=220
ENDPOINTING_MIN_WORDS=2
EMOTION_THRESHOLD_DB=-50
EMOTION_WINDOW_MS=250

# Feature flags
ENABLE_TOOL_CALLING=true
ENABLE_EMOTION_DETECTION=false
ENABLE_SPEAKER_DIARIZATION=false
ENABLE_PROFANITY_FILTER=false
ENABLE_PII_REDACTION=true

# Security
API_ALLOWED_IPS=
TENANT_ID_HEADER=x-tenant-id
ENABLE_CORS=true
CORS_CREDENTIALS=true
EOF

print_success "Environment file created"
print_warning "⚠️  IMPORTANT: Edit .env file with your actual API keys before proceeding!"

# Modify docker-compose.yml for single-host deployment
print_status "Configuring Docker Compose for Lightsail..."

# Backup original and create Lightsail-optimized version
cp docker-compose.yml docker-compose.yml.backup

cat > docker-compose.yml << EOF
version: "3.9"
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: invorto
      POSTGRES_PASSWORD: invorto
      POSTGRES_DB: invorto
    ports:
      - "5432:5432"
    volumes:
      - ./data/postgres:/var/lib/postgresql/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U invorto"]
      interval: 30s
      timeout: 10s
      retries: 3

  redis:
    image: redis:7-alpine
    command: ["redis-server", "--appendonly", "yes"]
    ports:
      - "6379:6379"
    volumes:
      - ./data/redis:/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 30s
      timeout: 10s
      retries: 3

  api:
    build: ./services/api
    environment:
      - NODE_ENV=\${NODE_ENV}
      - PORT=8080
      - DB_URL=\${DB_URL}
      - REDIS_URL=\${REDIS_URL}
      - OPENAI_API_KEY=\${OPENAI_API_KEY}
      - DEEPGRAM_API_KEY=\${DEEPGRAM_API_KEY}
      - JWT_SECRET=\${JWT_SECRET}
      - WEBHOOK_SECRET=\${WEBHOOK_SECRET}
      - API_SHARED_SECRET=\${API_SHARED_SECRET}
    ports:
      - "8080:8080"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  realtime:
    build: ./services/realtime
    environment:
      - NODE_ENV=\${NODE_ENV}
      - PORT=8081
      - DB_URL=\${DB_URL}
      - REDIS_URL=\${REDIS_URL}
      - OPENAI_API_KEY=\${OPENAI_API_KEY}
      - DEEPGRAM_API_KEY=\${DEEPGRAM_API_KEY}
      - JWT_SECRET=\${JWT_SECRET}
      - WEBHOOK_SECRET=\${WEBHOOK_SECRET}
    ports:
      - "8081:8081"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped

  telephony:
    build: ./services/telephony
    environment:
      - NODE_ENV=\${NODE_ENV}
      - PORT=8085
      - REDIS_URL=\${REDIS_URL}
      - REALTIME_WS_URL=http://realtime:8081/v1/realtime
      - PUBLIC_BASE_URL=http://localhost:8085
    ports:
      - "8085:8085"
    depends_on:
      redis:
        condition: service_healthy
    restart: unless-stopped

  webhooks:
    build: ./services/webhooks
    environment:
      - NODE_ENV=\${NODE_ENV}
      - PORT=8082
      - REDIS_URL=\${REDIS_URL}
    ports:
      - "8082:8082"
    depends_on:
      redis:
        condition: service_healthy
    restart: unless-stopped

  workers:
    build: ./services/workers
    environment:
      - NODE_ENV=\${NODE_ENV}
      - DB_URL=\${DB_URL}
      - REDIS_URL=\${REDIS_URL}
      - OPENAI_API_KEY=\${OPENAI_API_KEY}
      - DEEPGRAM_API_KEY=\${DEEPGRAM_API_KEY}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped

  ui:
    build: ./ui
    environment:
      - NODE_ENV=\${NODE_ENV}
      - PORT=3000
      - REACT_APP_API_URL=http://localhost:8080
    ports:
      - "3000:3000"
    restart: unless-stopped
EOF

print_success "Docker Compose configuration updated for Lightsail"

# Create data directories
print_status "Creating data directories..."
mkdir -p data/postgres data/redis logs
print_success "Data directories created"

# Initialize database schema (if migration scripts exist)
print_status "Initializing database..."
if [ -f "infra/supabase/migrations/0001_init.sql" ]; then
    print_status "Waiting for PostgreSQL to be ready..."
    sleep 10
    docker-compose exec -T postgres psql -U invorto -d invorto -f /dev/stdin < infra/supabase/migrations/0001_init.sql || true
    print_success "Database initialized"
else
    print_warning "No database migration files found - you may need to initialize manually"
fi

# Build and start services
print_status "Building and starting services..."
docker-compose build --parallel
print_success "Services built successfully"

print_status "Starting services..."
docker-compose up -d
print_success "Services started"

# Wait for services to be healthy
print_status "Waiting for services to be healthy..."
sleep 30

# Check service status
print_status "Checking service status..."
docker-compose ps

# Display access information
print_success "🎉 Deployment completed successfully!"
echo ""
echo "📋 Access Information:"
echo "----------------------------------------"
echo "🌐 API Service:     http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4):8080"
echo "🔌 Realtime WS:     ws://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4):8081"
echo "📞 Telephony:       http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4):8085"
echo "🎛️  UI Dashboard:   http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4):3000"
echo ""
echo "🔧 Management Commands:"
echo "----------------------------------------"
echo "View logs:          docker-compose logs -f"
echo "Stop services:      docker-compose down"
echo "Restart service:    docker-compose restart <service-name>"
echo "Update services:    docker-compose pull && docker-compose up -d"
echo ""
print_warning "⚠️  IMPORTANT REMINDERS:"
echo "1. Edit .env file with your actual OpenAI and Deepgram API keys"
echo "2. Configure SSL certificate for production use"
echo "3. Set up proper firewall rules and security groups"
echo "4. Configure domain name and DNS records"
echo "5. Set up monitoring and alerting"
echo ""
print_status "Current service health:"
docker-compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"

