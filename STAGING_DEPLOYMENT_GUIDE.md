# Staging Deployment Guide

This guide is for future reference when deploying to staging environment.

## Overview

Staging environment is a complete replica of production but with smaller scale and separate infrastructure.

## Infrastructure Components

- **VPC**: `staging-invorto-vpc` (10.1.0.0/16)
- **ECS Cluster**: `staging-invorto-cluster`
- **Load Balancer**: `staging-invorto-alb`
- **Database**: `staging-invorto-db` (db.t3.micro)
- **Redis**: `staging-invorto-redis` (cache.t3.micro)
- **Domain**: `staging.invortoai.com`

## Deployment Steps

### 1. Prerequisites

- AWS account with proper permissions
- SSL certificate for `staging.invortoai.com` in ACM
- S3 bucket `invorto-terraform-state` for state storage
- GitHub repository secrets configured

### 2. Terraform Configuration

```bash
cd infra/terraform

# Create staging backend config
cat > backend.staging.hcl << 'EOF'
bucket = "invorto-terraform-state"
key    = "staging/terraform.tfstate"
region = "ap-south-1"
EOF

# Create staging variables
cat > terraform.staging.tfvars << 'EOF'
environment = "staging"
domain_name = "staging.invortoai.com"
certificate_arn = "arn:aws:acm:ap-south-1:ACCOUNT_ID:certificate/STAGING_CERT_ID"

# Smaller scale for staging
api_desired_count = 1
realtime_desired_count = 1
webhooks_desired_count = 1
workers_desired_count = 1
telephony_desired_count = 1

db_instance_class = "db.t3.micro"
redis_node_type = "cache.t3.micro"
jambonz_desired_capacity = 1

monthly_budget = 200
EOF
```

### 3. Deploy Infrastructure

```bash
# Initialize staging
terraform init -backend-config=backend.staging.hcl

# Plan deployment
terraform plan -var-file=terraform.staging.tfvars -out=tfplan.staging

# Apply infrastructure
terraform apply tfplan.staging
```

### 4. DNS Configuration

Add CNAME record in Cloudflare:
```
staging.invortoai.com → staging-invorto-alb-12345.ap-south-1.elb.amazonaws.com
```

### 5. Deploy Services

Deploy ECS services manually or through CI/CD pipeline targeting staging environment.

### 6. Testing

Test staging endpoints:
- https://staging.invortoai.com/health
- https://staging.invortoai.com/graphql
- WebSocket connections
- File uploads

## Environment Variables

```bash
PUBLIC_BASE_URL=https://staging.invortoai.com
API_BASE_URL=https://staging.invortoai.com/v1
REALTIME_WS_URL=wss://staging.invortoai.com/realtime/voice
```

## Monitoring

- CloudWatch dashboards for staging metrics
- Separate alarms for staging environment
- Cost monitoring with $200/month budget

## Notes

- Staging uses same Docker images as production
- Separate database and Redis instances
- Independent scaling and configuration
- Safe for testing without affecting production