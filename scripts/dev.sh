#!/bin/bash

# Invorto Voice AI Platform - Development Script
# This script starts all services locally for development

set -e

echo "🚀 Starting Invorto Voice AI Platform development environment..."

# Check if docker-compose is available
if ! command -v docker-compose &> /dev/null; then
    echo "❌ docker-compose is not installed. Please install it first."
    exit 1
fi

# Check if Node.js is available
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install it first."
    exit 1
fi

# Check if npm is available
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install it first."
    exit 1
fi

echo "📦 Installing dependencies..."
npm install

echo "🐳 Starting infrastructure services..."
docker-compose up -d postgres redis

echo "⏳ Waiting for services to be ready..."
sleep 10

echo "🔨 Building all packages..."
npm run build

echo "🌐 Starting API service..."
npm run dev -w services/api &
API_PID=$!

echo "🔌 Starting Realtime service..."
npm run dev -w services/realtime &
REALTIME_PID=$!

echo "📡 Starting Webhooks service..."
npm run dev -w services/webhooks &
WEBHOOKS_PID=$!

echo "⚙️ Starting Workers service..."
npm run dev -w services/workers &
WORKERS_PID=$!

echo ""
echo "✅ Development environment started!"
echo ""
echo "📊 Services:"
echo "  • API: http://localhost:8080"
echo "  • Realtime: http://localhost:8081"
echo "  • Webhooks: http://localhost:8082"
echo "  • Postgres: localhost:5432"
echo "  • Redis: localhost:6379"
echo ""
echo "🔗 Health checks:"
echo "  • API: http://localhost:8080/health"
echo "  • Realtime: http://localhost:8081/health"
echo "  • Webhooks: http://localhost:8082/health"
echo ""
echo "🛑 To stop all services, run: ./scripts/stop-dev.sh"
echo ""

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "🛑 Stopping development environment..."
    kill $API_PID $REALTIME_PID $WEBHOOKS_PID $WORKERS_PID 2>/dev/null || true
    docker-compose down
    echo "✅ Development environment stopped."
    exit 0
}

# Trap SIGINT and SIGTERM
trap cleanup SIGINT SIGTERM

# Wait for all background processes
wait
